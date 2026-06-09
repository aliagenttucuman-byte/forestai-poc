"""add_vlm_columns_to_trees

Revision ID: a6d2596b90d9
Revises:
Create Date: 2026-05-21 18:50:22.585763
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a6d2596b90d9'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trees', sa.Column('vlm_species',    sa.String(100), nullable=True))
    op.add_column('trees', sa.Column('vlm_health',     sa.String(20),  nullable=True))
    op.add_column('trees', sa.Column('vlm_confidence', sa.Float(),     nullable=True))
    op.add_column('trees', sa.Column('vlm_notes',      sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('trees', 'vlm_notes')
    op.drop_column('trees', 'vlm_confidence')
    op.drop_column('trees', 'vlm_health')
    op.drop_column('trees', 'vlm_species')
