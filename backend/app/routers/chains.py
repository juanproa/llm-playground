from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.chain import (
    ChainCreate,
    ChainEdgeCreate,
    ChainEdgeResponse,
    ChainEdgeUpdate,
    ChainListItem,
    ChainNodeCreate,
    ChainNodeResponse,
    ChainNodeUpdate,
    ChainResponse,
    ChainRunListItem,
    ChainRunResponse,
    ChainUpdate,
    EdgeAssertion,
)
from app.services import chain_run_service, chain_service

router = APIRouter(tags=["chains"])


def _edge_response(edge) -> ChainEdgeResponse:
    import json

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


@router.get("/projects/{project_id}/chains", response_model=list[ChainListItem])
async def list_chains(project_id: str, db: AsyncSession = Depends(get_db)):
    chains = await chain_service.list_chains(db, project_id)
    return [
        ChainListItem(
            id=c.id,
            project_id=c.project_id,
            name=c.name,
            description=c.description,
            created_at=c.created_at,
            updated_at=c.updated_at,
            node_count=len(c.nodes),
            edge_count=len(c.edges),
        )
        for c in chains
    ]


@router.post("/projects/{project_id}/chains", response_model=ChainResponse, status_code=201)
async def create_chain(project_id: str, data: ChainCreate, db: AsyncSession = Depends(get_db)):
    return await chain_service.create_chain(db, project_id, data)


@router.get("/chains/{chain_id}", response_model=ChainResponse)
async def get_chain(chain_id: str, db: AsyncSession = Depends(get_db)):
    chain = await chain_service.get_chain(db, chain_id)
    if not chain:
        raise HTTPException(status_code=404, detail="Chain not found")
    return chain


@router.put("/chains/{chain_id}", response_model=ChainResponse)
async def update_chain(chain_id: str, data: ChainUpdate, db: AsyncSession = Depends(get_db)):
    chain = await chain_service.update_chain(db, chain_id, data)
    if not chain:
        raise HTTPException(status_code=404, detail="Chain not found")
    return chain


@router.delete("/chains/{chain_id}", status_code=204)
async def delete_chain(chain_id: str, db: AsyncSession = Depends(get_db)):
    if not await chain_service.delete_chain(db, chain_id):
        raise HTTPException(status_code=404, detail="Chain not found")


@router.post("/chains/{chain_id}/duplicate", response_model=ChainResponse, status_code=201)
async def duplicate_chain(chain_id: str, db: AsyncSession = Depends(get_db)):
    chain = await chain_service.duplicate_chain(db, chain_id)
    if not chain:
        raise HTTPException(status_code=404, detail="Chain not found")
    return chain


@router.post("/chains/{chain_id}/nodes", response_model=ChainNodeResponse, status_code=201)
async def create_node(chain_id: str, data: ChainNodeCreate, db: AsyncSession = Depends(get_db)):
    node = await chain_service.create_node(db, chain_id, data)
    if not node:
        raise HTTPException(status_code=404, detail="Chain not found")
    return node


@router.put("/chain-nodes/{node_id}", response_model=ChainNodeResponse)
async def update_node(node_id: str, data: ChainNodeUpdate, db: AsyncSession = Depends(get_db)):
    node = await chain_service.update_node(db, node_id, data)
    if not node:
        raise HTTPException(status_code=404, detail="Chain node not found")
    return node


@router.delete("/chain-nodes/{node_id}", status_code=204)
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db)):
    if not await chain_service.delete_node(db, node_id):
        raise HTTPException(status_code=404, detail="Chain node not found")


@router.post("/chains/{chain_id}/edges", response_model=ChainEdgeResponse, status_code=201)
async def create_edge(chain_id: str, data: ChainEdgeCreate, db: AsyncSession = Depends(get_db)):
    edge = await chain_service.create_edge(db, chain_id, data)
    if not edge:
        raise HTTPException(status_code=404, detail="Chain not found")
    return _edge_response(edge)


@router.put("/chain-edges/{edge_id}", response_model=ChainEdgeResponse)
async def update_edge(edge_id: str, data: ChainEdgeUpdate, db: AsyncSession = Depends(get_db)):
    edge = await chain_service.update_edge(db, edge_id, data)
    if not edge:
        raise HTTPException(status_code=404, detail="Chain edge not found")
    return _edge_response(edge)


@router.delete("/chain-edges/{edge_id}", status_code=204)
async def delete_edge(edge_id: str, db: AsyncSession = Depends(get_db)):
    if not await chain_service.delete_edge(db, edge_id):
        raise HTTPException(status_code=404, detail="Chain edge not found")


# ─── Chain runs ────────────────────────────────────────────────────────────


@router.post("/chains/{chain_id}/runs", response_model=ChainRunResponse, status_code=201)
async def start_run(chain_id: str, db: AsyncSession = Depends(get_db)):
    run = await chain_run_service.start_chain_run(db, chain_id)
    if not run:
        raise HTTPException(status_code=404, detail="Chain not found")
    # Commit before scheduling so the background task can read the run.
    await db.commit()
    chain_run_service.schedule_chain_run(run.id)
    return run


@router.get("/chains/{chain_id}/runs", response_model=list[ChainRunListItem])
async def list_runs(chain_id: str, db: AsyncSession = Depends(get_db)):
    return await chain_run_service.list_runs(db, chain_id)


@router.get("/chain-runs/{run_id}", response_model=ChainRunResponse)
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await chain_run_service.get_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Chain run not found")
    return run


@router.delete("/chain-runs/{run_id}", status_code=204)
async def delete_run(run_id: str, db: AsyncSession = Depends(get_db)):
    if not await chain_run_service.delete_run(db, run_id):
        raise HTTPException(status_code=404, detail="Chain run not found")


@router.post("/chain-runs/{run_id}/cancel", response_model=ChainRunResponse)
async def cancel_run(run_id: str, db: AsyncSession = Depends(get_db)):
    """Request cancellation of an in-flight run. The background executor checks
    between nodes and finalizes as 'cancelled'. Idempotent for terminal runs.
    """
    run = await chain_run_service.cancel_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Chain run not found")
    fresh = await chain_run_service.get_run(db, run_id)
    return fresh
