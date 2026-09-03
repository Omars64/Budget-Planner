from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class WalletIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str = "cash"
    initial_balance: Decimal = Decimal("0")
    icon: str = "wallet"
    color: str = "#0a4173"
    archived: bool = False


class LoginPayload(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "user"] = "user"
    active: bool = True


class UserUpdate(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=160)
    role: Literal["admin", "user"] = "user"
    active: bool = True
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class UserOut(ORMModel):
    id: int
    username: str
    email: str
    role: Literal["admin", "user"]
    active: bool
    created_at: datetime


class WalletOut(WalletIn, ORMModel):
    id: int
    balance: float = 0


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["income", "expense"]
    icon: str = "circle"
    color: str = "#0a4173"


class CategoryOut(CategoryIn, ORMModel):
    id: int


class TransactionIn(BaseModel):
    type: Literal["income", "expense", "transfer"]
    amount: Decimal = Field(gt=0)
    description: str = Field(min_length=1, max_length=160)
    notes: str = ""
    date: datetime
    wallet_id: int
    transfer_wallet_id: Optional[int] = None
    category_id: Optional[int] = None
    recurring_frequency: Literal["none", "daily", "weekly", "monthly", "yearly"] = "none"
    recurring_until: Optional[date] = None

    @model_validator(mode="after")
    def validate_transaction(self):
        if self.type == "transfer":
            if not self.transfer_wallet_id:
                raise ValueError("A destination wallet is required for transfers")
            if self.transfer_wallet_id == self.wallet_id:
                raise ValueError("Transfer wallets must be different")
        elif self.transfer_wallet_id is not None:
            raise ValueError("Only transfers may have a destination wallet")
        if self.recurring_until and self.recurring_until < self.date.date():
            raise ValueError("Repeat-until date cannot be before the transaction date")
        return self


class TransactionOut(TransactionIn, ORMModel):
    id: int
    wallet_name: str = ""
    transfer_wallet_name: Optional[str] = None
    category_name: Optional[str] = None
    category_color: Optional[str] = None


class BudgetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category_id: Optional[int] = None
    limit_amount: Decimal = Field(gt=0)
    period: Literal["weekly", "monthly", "yearly"] = "monthly"
    start_date: date
    notify_threshold: int = Field(default=80, ge=1, le=100)


class BudgetOut(BudgetIn, ORMModel):
    id: int
    spent: float = 0
    remaining: float = 0
    progress: float = 0
    category_name: Optional[str] = None


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_amount: Decimal = Field(gt=0)
    current_amount: Decimal = Field(default=Decimal("0"), ge=0)
    deadline: Optional[date] = None
    icon: str = "target"
    color: str = "#0a4173"


class GoalOut(GoalIn, ORMModel):
    id: int
    progress: float = 0


class ContributionIn(BaseModel):
    amount: Decimal = Field(gt=0)


class DebtIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["owed", "receivable"] = "owed"
    principal: Decimal = Field(gt=0)
    remaining: Decimal = Field(ge=0)
    interest_rate: Decimal = Field(default=Decimal("0"), ge=0)
    due_date: Optional[date] = None
    minimum_payment: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str = ""


class DebtOut(DebtIn, ORMModel):
    id: int
    progress: float = 0


class PinPayload(BaseModel):
    pin: str = Field(pattern=r"^\d{4,8}$")


class SettingsPayload(BaseModel):
    currency: str = Field(default="KWD", min_length=3, max_length=6)
    display_name: str = Field(default="My Budget", min_length=1, max_length=80)
    week_starts_on: Literal["sunday", "monday"] = "sunday"
    compact_numbers: bool = False
