from fastapi import APIRouter, BackgroundTasks, Depends

from services.orders import get_order_service, send_receipt

router = APIRouter()


@router.get("/{order_id}")
def read_order(order_id: str, svc=Depends(get_order_service)):
    return svc.get(order_id)


@router.post("")
def create_order(payload: dict, background_tasks: BackgroundTasks, svc=Depends(get_order_service)):
    background_tasks.add_task(send_receipt, payload["order_id"])
    return svc.create(payload)
