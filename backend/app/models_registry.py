"""Single import point for every ORM model.

Alembic must see every table before it compares metadata to the database;
without this, a model that nothing else imports silently disappears from
migrations. Import this module — never rely on import side effects elsewhere.
"""

from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.identity.models import AppUser
from app.modules.tenancy.models import Organization, Store

__all__ = [
    "AppUser",
    "Membership",
    "Organization",
    "Role",
    "RolePermission",
    "Store",
]
