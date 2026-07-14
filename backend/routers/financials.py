from fastapi import APIRouter, HTTPException
from services.financial_data import get_us_financials, get_kr_financials

router = APIRouter()


@router.get("/{market}/{ticker}")
def get_financials(market: str, ticker: str):
    try:
        if market.upper() == "US":
            return get_us_financials(ticker.upper())
        else:
            return get_kr_financials(ticker)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"재무 데이터 조회 실패: {e}")
