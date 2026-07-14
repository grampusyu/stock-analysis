import os
import pickle
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.preprocessing import MinMaxScaler
from typing import Callable

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

SEQ_LEN = 60
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
MODEL_MAX_AGE_DAYS = 7
FEATURES = ["close", "volume", "ma5", "ma20", "rsi", "macd"]
N_FEATURES = len(FEATURES)


def add_technical_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ma5"] = df["close"].rolling(5).mean()
    df["ma20"] = df["close"].rolling(20).mean()
    df["ma60"] = df["close"].rolling(60).mean()

    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss
    df["rsi"] = 100 - (100 / (1 + rs))

    ema12 = df["close"].ewm(span=12, adjust=False).mean()
    ema26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()

    df["bb_mid"] = df["close"].rolling(20).mean()
    std = df["close"].rolling(20).std()
    df["bb_upper"] = df["bb_mid"] + 2 * std
    df["bb_lower"] = df["bb_mid"] - 2 * std

    return df


def _model_paths(ticker: str, market: str) -> tuple[str, str]:
    safe = f"{market}_{ticker}".replace(".", "_")
    os.makedirs(MODEL_DIR, exist_ok=True)
    return (
        os.path.join(MODEL_DIR, f"{safe}.keras"),
        os.path.join(MODEL_DIR, f"{safe}_scaler.pkl"),
    )


def _is_fresh(model_path: str) -> bool:
    if not os.path.exists(model_path):
        return False
    age = datetime.now() - datetime.fromtimestamp(os.path.getmtime(model_path))
    return age.days < MODEL_MAX_AGE_DAYS


def _build_sequences(scaled_X: np.ndarray, scaled_y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for i in range(SEQ_LEN, len(scaled_X)):
        X.append(scaled_X[i - SEQ_LEN:i])  # (SEQ_LEN, N_FEATURES)
        y.append(scaled_y[i])
    return np.array(X), np.array(y)


def _train(feat_matrix: np.ndarray, ticker: str, market: str,
           progress_cb: Callable | None = None):
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    from tensorflow.keras.callbacks import EarlyStopping, Callback

    feature_scaler = MinMaxScaler()
    close_scaler = MinMaxScaler()

    # X: 모든 피처 정규화, y: close만 별도 정규화
    scaled_X = feature_scaler.fit_transform(feat_matrix)
    scaled_y = close_scaler.fit_transform(feat_matrix[:, 0:1]).flatten()

    X, y = _build_sequences(scaled_X, scaled_y)

    model = Sequential([
        LSTM(128, return_sequences=True, input_shape=(SEQ_LEN, N_FEATURES)),
        Dropout(0.2),
        LSTM(64, return_sequences=False),
        Dropout(0.2),
        Dense(32, activation="relu"),
        Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")

    MAX_EPOCHS = 100
    callbacks = [EarlyStopping(monitor="val_loss", patience=10, restore_best_weights=True)]

    if progress_cb:
        class _ProgressCB(Callback):
            def on_epoch_end(self, epoch, logs=None):
                val_loss = logs.get("val_loss") if logs else None
                progress_cb(epoch + 1, MAX_EPOCHS, val_loss)
        callbacks.append(_ProgressCB())

    model.fit(
        X, y,
        epochs=MAX_EPOCHS,
        batch_size=32,
        validation_split=0.1,
        callbacks=callbacks,
        verbose=0,
    )

    model_path, scaler_path = _model_paths(ticker, market)
    model.save(model_path)
    with open(scaler_path, "wb") as f:
        pickle.dump({"feature": feature_scaler, "close": close_scaler, "version": 2}, f)

    return model, feature_scaler, close_scaler


def _load(ticker: str, market: str):
    from tensorflow.keras.models import load_model
    model_path, scaler_path = _model_paths(ticker, market)
    model = load_model(model_path)
    with open(scaler_path, "rb") as f:
        scalers = pickle.load(f)
    if not isinstance(scalers, dict) or scalers.get("version") != 2:
        raise ValueError("구버전 모델 — 재학습 필요")
    return model, scalers["feature"], scalers["close"]


def predict_price(df: pd.DataFrame, days_ahead: int = 7,
                  ticker: str = "unknown", market: str = "KR",
                  progress_cb: Callable | None = None) -> dict:
    df = add_technical_indicators(df).dropna()
    if len(df) < SEQ_LEN + 30:
        return {"error": "데이터 부족 (최소 90일 필요)"}

    feat_matrix = df[FEATURES].values.astype(float)
    model_path, _ = _model_paths(ticker, market)

    if _is_fresh(model_path):
        try:
            model, feature_scaler, close_scaler = _load(ticker, market)
        except Exception:
            model, feature_scaler, close_scaler = _train(feat_matrix, ticker, market, progress_cb)
    else:
        model, feature_scaler, close_scaler = _train(feat_matrix, ticker, market, progress_cb)

    # 다변수 다단계 예측
    history = feat_matrix.copy()
    preds = []

    for _ in range(days_ahead):
        window = feature_scaler.transform(history[-SEQ_LEN:])
        seq = window.reshape(1, SEQ_LEN, N_FEATURES)
        pred_scaled = float(model.predict(seq, verbose=0)[0, 0])
        pred_close = float(close_scaler.inverse_transform([[pred_scaled]])[0, 0])
        preds.append(pred_close)

        # 다음 스텝 피처 행 추정 (close 갱신, volume은 5일 평균, MA 재계산)
        new_row = history[-1].copy()
        new_row[0] = pred_close
        new_row[1] = float(history[-5:, 1].mean())  # volume 5일 평균
        ext_close = np.append(history[:, 0], pred_close)
        new_row[2] = float(ext_close[-5:].mean())   # ma5
        new_row[3] = float(ext_close[-20:].mean())  # ma20
        # rsi, macd는 마지막 값 유지 (근사)
        history = np.vstack([history, new_row])

    last_date = pd.to_datetime(df.index[-1])
    future_dates = pd.date_range(
        last_date + pd.Timedelta(days=1), periods=days_ahead, freq="B"
    )

    return {
        "predictions": [
            {"date": d.strftime("%Y-%m-%d"), "price": round(float(p), 2)}
            for d, p in zip(future_dates, preds)
        ],
        "trend": "상승" if preds[-1] > feat_matrix[-1, 0] else "하락",
        "model": "LSTM",
    }


def get_technical_summary(df: pd.DataFrame) -> dict:
    df = add_technical_indicators(df).dropna()
    if df.empty:
        return {}

    latest = df.iloc[-1]
    price = latest["close"]

    signals = []
    if latest["ma5"] > latest["ma20"]:
        signals.append({"indicator": "MA", "signal": "매수", "desc": "단기 이평이 중기 이평 위"})
    else:
        signals.append({"indicator": "MA", "signal": "매도", "desc": "단기 이평이 중기 이평 아래"})

    if latest["rsi"] < 30:
        signals.append({"indicator": "RSI", "signal": "매수", "desc": f"RSI {latest['rsi']:.1f} 과매도 구간"})
    elif latest["rsi"] > 70:
        signals.append({"indicator": "RSI", "signal": "매도", "desc": f"RSI {latest['rsi']:.1f} 과매수 구간"})
    else:
        signals.append({"indicator": "RSI", "signal": "중립", "desc": f"RSI {latest['rsi']:.1f}"})

    if latest["macd"] > latest["macd_signal"]:
        signals.append({"indicator": "MACD", "signal": "매수", "desc": "MACD > Signal"})
    else:
        signals.append({"indicator": "MACD", "signal": "매도", "desc": "MACD < Signal"})

    return {
        "price": price,
        "ma5": round(latest["ma5"], 2),
        "ma20": round(latest["ma20"], 2),
        "ma60": round(latest["ma60"], 2),
        "rsi": round(latest["rsi"], 2),
        "macd": round(latest["macd"], 2),
        "bb_upper": round(latest["bb_upper"], 2),
        "bb_lower": round(latest["bb_lower"], 2),
        "signals": signals,
    }
