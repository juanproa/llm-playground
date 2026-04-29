import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chain import Chain, ChainEdge, ChainNode, ChainNodeRun, ChainRun
from app.schemas.chain import (
    ChainCreate,
    ChainEdgeCreate,
    ChainEdgeResponse,
    ChainEdgeUpdate,
    ChainNodeCreate,
    ChainNodeUpdate,
    ChainResponse,
    ChainUpdate,
    EdgeAssertion,
)


def _edge_to_response(edge: ChainEdge) -> ChainEdgeResponse:
    assertion: EdgeAssertion | None = None
    if edge.assertion_json:
        try:
            assertion = EdgeAssertion.model_validate(json.loads(edge.assertion_json))
        except Exception:
            assertion = None
    return ChainEdgeResponse(
        id=edge.id,
        chain_id=edge.chain_id,
        source_node_id=edge.source_node_id,
        target_node_id=edge.target_node_id,
        assertion=assertion,
        created_at=edge.created_at,
    )


def _chain_to_response(chain: Chain) -> ChainResponse:
    return ChainResponse(
        id=chain.id,
        project_id=chain.project_id,
        name=chain.name,
        description=chain.description,
        created_at=chain.created_at,
        updated_at=chain.updated_at,
        nodes=[
            {
                "id": n.id,
                "chain_id": n.chain_id,
                "name": n.name,
                "position_x": n.position_x,
                "position_y": n.position_y,
                "prompt_version_id": n.prompt_version_id,
                "model_config_id": n.model_config_id,
                "kb_id": n.kb_id,
                "kb_top_k": n.kb_top_k,
                "kb_query_template": n.kb_query_template,
                "input_text": n.input_text,
                "input_document_id": n.input_document_id,
                "created_at": n.created_at,
                "updated_at": n.updated_at,
            }
            for n in chain.nodes
        ],
        edges=[_edge_to_response(e) for e in chain.edges],
    )


async def _load_chain(db: AsyncSession, chain_id: str) -> Chain | None:
    result = await db.execute(
        select(Chain)
        .where(Chain.id == chain_id)
        .options(selectinload(Chain.nodes), selectinload(Chain.edges))
    )
    return result.scalar_one_or_none()


async def list_chains(db: AsyncSession, project_id: str) -> list[Chain]:
    result = await db.execute(
        select(Chain)
        .where(Chain.project_id == project_id)
        .options(selectinload(Chain.nodes), selectinload(Chain.edges))
        .order_by(Chain.created_at.desc())
    )
    return list(result.scalars().all())


async def get_chain(db: AsyncSession, chain_id: str) -> ChainResponse | None:
    chain = await _load_chain(db, chain_id)
    return _chain_to_response(chain) if chain else None


async def create_chain(db: AsyncSession, project_id: str, data: ChainCreate) -> ChainResponse:
    chain = Chain(project_id=project_id, name=data.name, description=data.description)
    db.add(chain)
    await db.flush()
    return await get_chain(db, chain.id)  # type: ignore[return-value]


async def update_chain(db: AsyncSession, chain_id: str, data: ChainUpdate) -> ChainResponse | None:
    chain = await _load_chain(db, chain_id)
    if not chain:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(chain, key, value)
    await db.flush()
    return _chain_to_response(chain)


async def duplicate_chain(db: AsyncSession, chain_id: str) -> ChainResponse | None:
    """Deep-copy a chain (metadata + nodes + edges) within the same project.

    Node IDs are regenerated, so the new chain is fully independent — editing
    or running the copy never touches the source. Past runs are NOT copied;
    history belongs to the executed chain.

    Name collision policy: append " (copy)", and if that name already exists
    in the project, bump to "(copy 2)", "(copy 3)", etc. Cheap to compute and
    keeps the sidebar readable when a user duplicates the same chain twice.
    """
    src = await _load_chain(db, chain_id)
    if not src:
        return None

    existing_result = await db.execute(
        select(Chain.name).where(Chain.project_id == src.project_id)
    )
    existing_names = {n for (n,) in existing_result.all()}

    new_name = f"{src.name} (copy)"
    counter = 2
    while new_name in existing_names:
        new_name = f"{src.name} (copy {counter})"
        counter += 1

    new_chain = Chain(
        project_id=src.project_id,
        name=new_name,
        description=src.description,
    )
    db.add(new_chain)
    await db.flush()

    # Build old→new node ID map so we can remap edges in a second pass.
    id_map: dict[str, str] = {}
    for old_node in src.nodes:
        new_node = ChainNode(
            chain_id=new_chain.id,
            name=old_node.name,
            position_x=old_node.position_x,
            position_y=old_node.position_y,
            prompt_version_id=old_node.prompt_version_id,
            model_config_id=old_node.model_config_id,
            kb_id=old_node.kb_id,
            kb_top_k=old_node.kb_top_k,
            kb_query_template=old_node.kb_query_template,
            input_text=old_node.input_text,
            input_document_id=old_node.input_document_id,
        )
        db.add(new_node)
        await db.flush()
        id_map[old_node.id] = new_node.id

    for old_edge in src.edges:
        new_edge = ChainEdge(
            chain_id=new_chain.id,
            source_node_id=id_map[old_edge.source_node_id],
            target_node_id=id_map[old_edge.target_node_id],
            assertion_json=old_edge.assertion_json,
        )
        db.add(new_edge)
    await db.flush()

    return await get_chain(db, new_chain.id)


async def delete_chain(db: AsyncSession, chain_id: str) -> bool:
    chain = await db.get(Chain, chain_id)
    if not chain:
        return False
    # Explicitly delete past runs first. Their node_runs cascade via the
    # ChainRun.node_runs relationship. We do this in the service rather than
    # relying on Chain.runs cascade because async sessions don't lazy-load the
    # `runs` collection during cascade — `db.delete(chain)` would otherwise hit
    # the chain_runs.chain_id FK and 500.
    runs_result = await db.execute(select(ChainRun).where(ChainRun.chain_id == chain_id))
    for run in runs_result.scalars().all():
        await db.delete(run)
    await db.flush()
    # Chain → nodes/edges cascade is already configured on the model.
    await db.delete(chain)
    await db.flush()
    return True


async def create_node(db: AsyncSession, chain_id: str, data: ChainNodeCreate) -> ChainNode | None:
    chain = await db.get(Chain, chain_id)
    if not chain:
        return None
    node = ChainNode(chain_id=chain_id, **data.model_dump())
    db.add(node)
    await db.flush()
    return node


async def update_node(db: AsyncSession, node_id: str, data: ChainNodeUpdate) -> ChainNode | None:
    node = await db.get(ChainNode, node_id)
    if not node:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(node, key, value)
    await db.flush()
    return node


async def delete_node(db: AsyncSession, node_id: str) -> bool:
    node = await db.get(ChainNode, node_id)
    if not node:
        return False
    # ChainNodeRun has a NOT NULL FK back to ChainNode; once a chain has been
    # executed at least once those rows pin the node and SQLite (foreign_keys=ON)
    # rejects the delete. Drop the per-run history along with the node — the
    # parent ChainRun rows stay so other nodes' history is intact.
    await db.execute(delete(ChainNodeRun).where(ChainNodeRun.node_id == node_id))
    # Also delete edges touching this node to keep the graph consistent.
    await db.execute(
        delete(ChainEdge).where(
            (ChainEdge.source_node_id == node_id) | (ChainEdge.target_node_id == node_id)
        )
    )
    await db.delete(node)
    await db.flush()
    return True


async def create_edge(db: AsyncSession, chain_id: str, data: ChainEdgeCreate) -> ChainEdge | None:
    chain = await db.get(Chain, chain_id)
    if not chain:
        return None
    edge = ChainEdge(
        chain_id=chain_id,
        source_node_id=data.source_node_id,
        target_node_id=data.target_node_id,
        assertion_json=data.assertion.model_dump_json() if data.assertion else None,
    )
    db.add(edge)
    await db.flush()
    return edge


async def update_edge(db: AsyncSession, edge_id: str, data: ChainEdgeUpdate) -> ChainEdge | None:
    edge = await db.get(ChainEdge, edge_id)
    if not edge:
        return None
    payload = data.model_dump(exclude_unset=True)
    if payload.pop("clear_assertion", False):
        edge.assertion_json = None
    if "assertion" in payload:
        edge.assertion_json = (
            data.assertion.model_dump_json() if data.assertion else None
        )
    await db.flush()
    return edge


async def delete_edge(db: AsyncSession, edge_id: str) -> bool:
    edge = await db.get(ChainEdge, edge_id)
    if not edge:
        return False
    await db.delete(edge)
    await db.flush()
    return True
