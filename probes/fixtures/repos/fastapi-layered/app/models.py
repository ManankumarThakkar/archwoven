from sqlmodel import Field, SQLModel


class UserBase(SQLModel):
    email: str


class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)


class Item(SQLModel, table=True):
    __tablename__ = "inventory_items"
    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id")


class ItemPublic(SQLModel):
    id: int
