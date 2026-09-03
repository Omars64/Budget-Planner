from fastapi.testclient import TestClient

from api.app import app
import api.extensions as extensions

ADMIN_EMAIL = "omarsolanki46@gmail.com"
ADMIN_PASSWORD = "FlowBudgetAdmin!ChangeMe2026"


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def admin_headers(client):
    response = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert response.status_code == 200, response.text
    return headers(response.json()["token"])


def test_verified_signup_reentry_appearance_and_shared_wallet(monkeypatch):
    sent = {}
    monkeypatch.setattr(extensions, "send_code", lambda email, username, code: sent.__setitem__(email, code))

    with TestClient(app) as client:
        signup = {"username": "Shared Tester", "email": "shared-tester@example.com", "password": "StrongPass123!"}
        first = client.post("/api/auth/signup/start", json=signup)
        assert first.status_code == 200, first.text
        assert first.json()["sent"] is True
        assert len(sent[signup["email"]]) == 6

        # Returning to sign-up before verification must not create a duplicate user.
        second = client.post("/api/auth/signup/start", json=signup)
        assert second.status_code == 200, second.text
        assert second.json()["sent"] is False

        verified = client.post("/api/auth/signup/verify", json={"challenge": second.json()["challenge"], "code": sent[signup["email"]]})
        assert verified.status_code == 200, verified.text
        member_headers = headers(verified.json()["token"])
        assert client.post("/api/auth/signup/start", json=signup).status_code == 409

        tiny_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII="
        appearance = client.put("/api/account/appearance", headers=member_headers, json={"profile_image": tiny_png})
        assert appearance.status_code == 200, appearance.text

        owner_headers = admin_headers(client)
        wallet = client.get("/api/wallets", headers=owner_headers).json()[0]
        share = client.post(f"/api/shared/wallets/{wallet['id']}/shares", headers=owner_headers, json={"email": signup["email"], "permission": "edit"})
        assert share.status_code == 201, share.text
        assert share.json()["registered"] is True

        shared_wallets = client.get("/api/shared/wallets", headers=member_headers).json()
        assert next(w for w in shared_wallets if w["wallet_id"] == wallet["id"])["can_edit"] is True

        categories = client.get(f"/api/shared/wallets/{wallet['id']}/categories", headers=member_headers).json()
        category = next(c for c in categories if c["kind"] == "expense")
        payload = {
            "type": "expense", "amount": 4.250, "description": "Collaborative regression", "notes": "",
            "date": "2026-09-03T12:00:00", "wallet_id": wallet["id"], "transfer_wallet_id": None,
            "category_id": category["id"], "recurring_frequency": "none", "recurring_until": None,
        }
        created = client.post("/api/shared/transactions", headers=member_headers, json=payload)
        assert created.status_code == 201, created.text
        assert created.json()["can_edit"] is True
        assert wallet["name"] in created.json()["shared_wallet_names"]

        owner_rows = client.get("/api/transactions?search=Collaborative%20regression", headers=owner_headers).json()
        assert any(row["id"] == created.json()["id"] for row in owner_rows)

        downgrade = client.post(f"/api/shared/wallets/{wallet['id']}/shares", headers=owner_headers, json={"email": signup["email"], "permission": "view"})
        assert downgrade.status_code == 201
        assert client.post("/api/shared/transactions", headers=member_headers, json={**payload, "description": "Should fail"}).status_code == 403
