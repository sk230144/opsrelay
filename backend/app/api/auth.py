from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app import models, schemas
from app.core.deps import CurrentUser, DbSession
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.services.serialize import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenOut)
def login(payload: schemas.LoginIn, db: DbSession) -> schemas.TokenOut:
    user = db.scalar(
        select(models.User).where(models.User.email == payload.email.lower())
    )
    # One message for both unknown email and wrong password, so the endpoint
    # cannot be used to enumerate valid accounts.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )

    return schemas.TokenOut(
        user=user_out(user),
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=schemas.RefreshOut)
def refresh(payload: schemas.RefreshIn, db: DbSession) -> schemas.RefreshOut:
    user_id = decode_token(payload.refreshToken, "refresh")
    if user_id is None or db.get(models.User, user_id) is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )

    # Rotate both tokens, so a leaked refresh token has a bounded lifetime.
    return schemas.RefreshOut(
        accessToken=create_access_token(user_id),
        refreshToken=create_refresh_token(user_id),
    )


@router.get("/me", response_model=schemas.UserOut)
def me(user: CurrentUser) -> schemas.UserOut:
    return user_out(user)


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def set_push_token(payload: schemas.PushTokenIn, user: CurrentUser, db: DbSession) -> None:
    user.push_token = payload.token
    db.add(user)
    db.commit()
