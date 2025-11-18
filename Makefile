.PHONY: dev-backend dev-frontend test-backend lint-frontend test

dev-backend:
	cd backend && uvicorn app.main:app --reload

dev-frontend:
	cd frontend && npm install && npm run dev

test-backend:
	cd backend && pytest

lint-frontend:
	cd frontend && npm run lint

test: test-backend lint-frontend
