from sqlmodel import Session


class AuditService:
    def __init__(self, session: Session | None = None):
        self.session = session
