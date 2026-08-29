# SMILE-01 Railway Dispatcher

Railway-ready package for the PPSSE Twin A ↔ Twin B SMILE-01 experiment.

## Railway variables
Set these in the Railway service Variables tab:
- OPENAI_API_KEY
- GOOGLE_SERVICE_ACCOUNT_JSON
- SMILE_DOC_ID (already shown in .env.example)
- OPENAI_MODEL (optional)

The process also starts a tiny HTTP health/status endpoint on Railway's PORT.

Do not commit real credentials.
