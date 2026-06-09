from celery import Celery
from app.config import settings

celery_app = Celery(
    "forestai",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.analysis_task", "app.tasks.netflora_task", "app.tasks.tree_detection_task"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Argentina/Buenos_Aires",
    enable_utc=True,
)
