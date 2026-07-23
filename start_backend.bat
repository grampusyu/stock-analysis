@echo off
cd /d D:\02_Project\stock-analysis\backend
"C:\Users\Yu\anaconda3\envs\stock_analysis\Scripts\uvicorn.exe" main:app --reload --port 8000
