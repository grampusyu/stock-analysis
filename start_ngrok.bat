@echo off
SET "PATH=C:\Windows;%PATH%"
ngrok http --url=doze-backed-uncorrupt.ngrok-free.dev 3000
