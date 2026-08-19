"""No-op Alembic environment reserved for future persisted Agent runs."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, pool

target_metadata = None


def run_migrations_offline() -> None:
    context.configure(url=context.config.get_main_option("sqlalchemy.url"), literal_binds=True, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # There are no application tables in this patch, but using a real SQLite
    # connection keeps the standard ``alembic upgrade head`` command valid.
    connectable = create_engine(context.config.get_main_option("sqlalchemy.url"), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
