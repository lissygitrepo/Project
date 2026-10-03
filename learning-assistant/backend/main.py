from fastapi import FastAPI
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(title="AI Learning Assistant API")

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Backend is running"}

@app.get("/config-check")
def config_check():
    return {"groq_key_loaded": bool(os.getenv("GROQ_API_KEY"))}