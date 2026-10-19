from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from api.database import Base
from api.models import User
from api.reliability_models import ServiceEvent
from api.service_events import record_event


def test_logging_does_not_borrow_or_commit_the_request_pool(tmp_path):
    source = create_engine('sqlite:///' + (tmp_path / 'events.db').as_posix(), pool_size=1,max_overflow=0,pool_timeout=.1)
    Base.metadata.create_all(source)
    checkouts = []
    event.listen(source,'checkout',lambda *args: checkouts.append(True))
    with Session(source) as request:
        request.query(User).count()
        request.add(User(username='Uncommitted',email='synthetic@example.test',password_hash='unused'))
        record_event('/api/dashboard',200,2100,source)
        assert len(checkouts) == 1
        assert len(request.new) == 1
        request.rollback()
    with Session(source) as verification:
        assert verification.query(User).count() == 0
        assert verification.query(ServiceEvent).count() == 1
    source.dispose()
