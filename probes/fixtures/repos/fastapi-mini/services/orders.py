import httpx
from sqlalchemy.orm import Session

from models import Order


class OrderService:
    def __init__(self, session: Session):
        self.session = session

    def get(self, order_id: str):
        return self.session.query(Order).get(order_id)

    def create(self, payload: dict):
        return httpx.post("https://payments.example.com/charge", json=payload)


def get_order_service():
    return OrderService(session=None)


def send_receipt(order_id: str):
    return httpx.post("https://payments.example.com/receipt", json={"order_id": order_id})
