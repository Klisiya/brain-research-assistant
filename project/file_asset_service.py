"""Resource-authorized assets and reference-safe transactional cleanup.

Adapters register real relation models with an asset_id RESTRICT foreign key.
Callers own commit/rollback; retiring metadata and queueing cleanup are atomic.
No method exposes an asset through a public, context-free download URL.
"""
from dataclasses import dataclass
from sqlalchemy import inspect, select
from sqlalchemy.exc import SQLAlchemyError
from attachment_files import AttachmentError, validate_file, validate_external_url
from file_assets import ASSET_FIELDS


@dataclass(frozen=True)
class ResourcePolicy:
    relation_model: object
    resource_id_field: str
    can_read: object
    can_manage: object


class FileAssetService:
    def __init__(self, db, Asset, Cleanup, storage, logger):
        self.db, self.Asset, self.Cleanup = db, Asset, Cleanup
        self.storage, self.logger = storage, logger
        self.policies = {}

    def register_resource(self, kind, relation_model, resource_id_field, *, can_read, can_manage):
        if kind in self.policies or not callable(can_read) or not callable(can_manage):
            raise ValueError("Invalid resource policy registration.")
        foreign_keys = relation_model.__table__.c.asset_id.foreign_keys
        if not any(fk.target_fullname == "file_assets.id" and fk.ondelete == "RESTRICT" for fk in foreign_keys):
            raise ValueError("Asset references must have a RESTRICT foreign key.")
        self.policies[kind] = ResourcePolicy(relation_model, resource_id_field, can_read, can_manage)

    def authorize(self, kind, resource, relation=None, *, manage=False):
        policy = self.policies.get(kind)
        resource_state = inspect(resource, raiseerr=False)
        if resource_state is None or not resource_state.persistent or (not manage and relation is None):
            raise AttachmentError("Invalid resource context.", "ATTACHMENT_ACCESS_DENIED", 403)
        if policy is None or (relation is not None and (
            not isinstance(relation, policy.relation_model)
            or getattr(relation, policy.resource_id_field) != resource.id
        )):
            raise AttachmentError("Invalid resource context.", "ATTACHMENT_ACCESS_DENIED", 403)
        if not manage and not inspect(relation).persistent:
            raise AttachmentError("Invalid resource context.", "ATTACHMENT_ACCESS_DENIED", 403)
        allowed = policy.can_manage(resource) if manage else policy.can_read(resource, relation)
        if not allowed:
            raise AttachmentError("Resource access is not allowed.", "ATTACHMENT_ACCESS_DENIED", 403)

    def validate_upload(self, upload, asset_type, limits=None):
        return validate_file(upload, asset_type, limits)

    def save(self, kind, resource, stream, extension, *, replacing=False):
        self.authorize(kind, resource, manage=True)
        backend = self.storage()
        write = backend.replace_file if replacing else backend.save_file
        if kind == "paper":
            return write(stream, resource.id, extension)
        return write(stream, resource.id, extension, namespace="assets")

    def create(self, kind, resource, values, actor_id):
        self.authorize(kind, resource, manage=True)
        if values["attachment_type"] == "external_link":
            validate_external_url(values["external_url"])
        elif not self.storage().exists(values.get("storage_key")):
            raise AttachmentError("Stored file is unavailable.", "ATTACHMENT_NOT_FOUND", 404)
        asset = self.Asset(asset_type=values["attachment_type"], created_by_id=actor_id,
                           **{name: values.get(name) for name in ASSET_FIELDS})
        self.db.session.add(asset)
        self.db.session.flush()
        return asset

    def bind_existing(self, kind, resource, relation, *, source_kind, source_resource, source_relation):
        # Republishing requires persisted source identity and management of both resources.
        state = inspect(source_relation, raiseerr=False)
        if state is None or not state.persistent:
            raise AttachmentError("Invalid source relation.", "ATTACHMENT_ACCESS_DENIED", 403)
        self.authorize(source_kind, source_resource, source_relation, manage=True)
        self.authorize(kind, resource, relation, manage=True)
        with self.db.session.no_autoflush:
            asset = self.db.session.scalar(select(self.Asset).where(
                self.Asset.id == source_relation.asset_id).with_for_update())
        if asset is None:
            raise AttachmentError("Asset no longer exists.", "ATTACHMENT_NOT_FOUND", 404)
        if getattr(relation, "attachment_type", asset.asset_type) != asset.asset_type:
            raise AttachmentError("Asset type does not match the relation.")
        relation.asset_id = asset.id
        if hasattr(relation, "asset"):
            relation.asset = asset
        for name in ASSET_FIELDS:
            if hasattr(relation, name):
                setattr(relation, name, getattr(asset, name))
        return asset

    def open(self, kind, resource, relation):
        self.authorize(kind, resource, relation)
        asset = relation.asset if relation.asset_id is not None else relation
        if asset.external_url is not None:
            raise AttachmentError("External resources cannot be downloaded.", "ATTACHMENT_NOT_DOWNLOADABLE")
        return self.storage().open_file(asset.storage_key)

    def queue_cleanup(self, key):
        if key and self.db.session.get(self.Cleanup, key) is None:
            self.db.session.add(self.Cleanup(storage_key=key))

    def retire_unreferenced(self, asset_ids):
        self.db.session.flush()
        for asset_id in sorted({value for value in asset_ids if value is not None}):
            asset = self.db.session.scalar(select(self.Asset).where(self.Asset.id == asset_id).with_for_update())
            if asset is None:
                continue
            if any(self.db.session.query(policy.relation_model).filter_by(asset_id=asset_id).first() is not None
                   for policy in self.policies.values()):
                continue
            self.queue_cleanup(asset.storage_key)
            self.db.session.delete(asset)
            # Unknown future FK references veto retirement before files can be touched.
            self.db.session.flush()

    def key_is_referenced(self, key):
        if self.db.session.query(self.Asset.id).filter_by(storage_key=key).first() is not None:
            return True
        # Legacy rows without asset_id remain protected during staged adoption.
        return any(hasattr(policy.relation_model, "storage_key") and
                   self.db.session.query(policy.relation_model).filter_by(storage_key=key).first() is not None
                   for policy in self.policies.values())

    def drain_cleanup(self, keys=None):
        query = self.db.session.query(self.Cleanup)
        if keys is not None:
            if not keys:
                return 0
            query = query.filter(self.Cleanup.storage_key.in_(keys))
        query = query.order_by(self.Cleanup.created_at, self.Cleanup.storage_key)
        if keys is None:
            query = query.limit(100)
        pending = 0
        for item in query.all():
            try:
                if self.key_is_referenced(item.storage_key):
                    self.logger.error("Attachment cleanup category=still_referenced")
                    pending += 1
                    continue
                if not self.storage().delete_file(item.storage_key):
                    self.logger.warning("Attachment cleanup category=disk_file_missing")
                self.db.session.delete(item)
                self.db.session.commit()
            except (OSError, ValueError, SQLAlchemyError) as error:
                self.db.session.rollback()
                self.logger.error("Attachment cleanup category=%s; retry required", type(error).__name__)
                pending += 1
        return pending

    def compensate(self, keys):
        for key in keys:
            try:
                if not self.key_is_referenced(key):
                    self.storage().delete_file(key)
            except (OSError, ValueError, SQLAlchemyError) as error:
                self.logger.error("Attachment operation=rollback_cleanup category=%s", type(error).__name__)
                self.db.session.rollback()
                try:
                    self.queue_cleanup(key)
                    self.db.session.commit()
                except SQLAlchemyError as queue_error:
                    self.db.session.rollback()
                    self.logger.error("Attachment operation=rollback_cleanup_queue category=%s", type(queue_error).__name__)
