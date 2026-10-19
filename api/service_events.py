"""Best-effort diagnostics must not borrow the financial request's pool."""
from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from .database import engine
from .reliability_models import ServiceEvent


@lru_cache(maxsize=4)
def event_engine(url):
    if url.get_backend_name() == 'sqlite':
        if not url.database or url.database == ':memory:':
            raise ValueError('Independent diagnostics require persistent local storage')
        arguments = {'check_same_thread': False, 'timeout': 0.1}
    else:
        arguments = {'connect_timeout': 2}
    return create_engine(url, poolclass=NullPool, connect_args=arguments)


def record_event(area, status, duration, source=None):
    target = event_engine((source if source is not None else engine).url)
    with target.begin() as connection:
        if connection.dialect.name == 'postgresql':
            connection.exec_driver_sql("SET LOCAL statement_timeout = '250ms'")
            connection.exec_driver_sql("SET LOCAL lock_timeout = '250ms'")
        connection.execute(ServiceEvent.__table__.insert().values(
            area=area[:100], status=status, duration_ms=duration))
