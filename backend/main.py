from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import stocks, portfolio, analysis, realtime, financials, news, watchlist, screener, recommend
from dotenv import load_dotenv
load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    stocks.start_full_kr_map_build()
    yield


app = FastAPI(title="Stock Analysis API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router, prefix="/api/stocks", tags=["stocks"])
app.include_router(portfolio.router, prefix="/api/portfolio", tags=["portfolio"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(realtime.router, prefix="/api/realtime", tags=["realtime"])
app.include_router(financials.router, prefix="/api/financials", tags=["financials"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(watchlist.router, prefix="/api/watchlist", tags=["watchlist"])
app.include_router(screener.router, prefix="/api/screener", tags=["screener"])
app.include_router(recommend.router, prefix="/api/recommend", tags=["recommend"])


@app.get("/health")
def health_check():
    return {"status": "ok"}
