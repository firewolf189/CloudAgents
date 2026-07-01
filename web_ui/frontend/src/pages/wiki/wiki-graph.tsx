import { useCallback, useEffect, useRef, useState, type FC } from 'react';

import type { GraphData } from '@/api/types';

const CATEGORY_COLORS: Record<string, string> = {
	concepts: '#3b82f6',
	entities: '#22c55e',
	topics: '#a855f7',
	analysis: '#f97316',
	journal: '#eab308',
};
const DEFAULT_COLOR = '#6b7280';

interface Node {
	id: string;
	title: string;
	category: string;
	links: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

interface Edge {
	source: string;
	target: string;
}

interface WikiGraphProps {
	data: GraphData;
	onSelectNode: (path: string) => void;
}

export const WikiGraph: FC<WikiGraphProps> = ({ data, onSelectNode }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const nodesRef = useRef<Node[]>([]);
	const edgesRef = useRef<Edge[]>([]);
	const frameRef = useRef<number>(0);
	const [hovered, setHovered] = useState<string | null>(null);
	const hoveredRef = useRef<string | null>(null);
	const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
	const panRef = useRef({ x: 0, y: 0 });
	const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
	const zoomRef = useRef(1);

	useEffect(() => {
		const w = canvasRef.current?.parentElement?.clientWidth ?? 800;
		const h = canvasRef.current?.parentElement?.clientHeight ?? 600;
		const cx = w / 2;
		const cy = h / 2;

		if (data.nodes.length === 0) {
			nodesRef.current = [];
			edgesRef.current = [];
			return;
		}

		// 1. Find hub nodes (top N by link count)
		const sorted = [...data.nodes].sort((a, b) => b.links - a.links);
		const hubCount = Math.max(3, Math.min(8, Math.ceil(data.nodes.length / 15)));
		const hubIds = new Set(sorted.slice(0, hubCount).map(n => n.id));

		// 2. Build adjacency and assign each non-hub to its closest hub
		const adj = new Map<string, Set<string>>();
		for (const e of data.edges) {
			if (!adj.has(e.source)) adj.set(e.source, new Set());
			if (!adj.has(e.target)) adj.set(e.target, new Set());
			adj.get(e.source)!.add(e.target);
			adj.get(e.target)!.add(e.source);
		}

		const hubAssign = new Map<string, string>();
		const hubMembers = new Map<string, string[]>();
		for (const hid of hubIds) hubMembers.set(hid, []);

		for (const n of data.nodes) {
			if (hubIds.has(n.id)) continue;
			const neighbors = adj.get(n.id);
			let bestHub = sorted[0].id;
			let bestScore = 0;
			if (neighbors) {
				for (const hid of hubIds) {
					if (neighbors.has(hid)) {
						const hubNode = data.nodes.find(nd => nd.id === hid);
						const score = 10 + (hubNode?.links ?? 0);
						if (score > bestScore) { bestScore = score; bestHub = hid; }
					}
				}
				if (bestScore === 0) {
					for (const hid of hubIds) {
						const hNeighbors = adj.get(hid);
						if (!hNeighbors) continue;
						let shared = 0;
						for (const nb of neighbors) { if (hNeighbors.has(nb)) shared++; }
						if (shared > bestScore) { bestScore = shared; bestHub = hid; }
					}
				}
			}
			hubAssign.set(n.id, bestHub);
			hubMembers.get(bestHub)?.push(n.id);
		}

		// 3. Place hubs spread out in a large circle
		const hubList = [...hubIds];
		const hubRadius = Math.min(w, h) * 0.35;
		const hubPositions = new Map<string, { x: number; y: number }>();
		for (let i = 0; i < hubList.length; i++) {
			const angle = (2 * Math.PI * i) / hubList.length - Math.PI / 2;
			hubPositions.set(hubList[i], {
				x: cx + Math.cos(angle) * hubRadius,
				y: cy + Math.sin(angle) * hubRadius,
			});
		}

		// 4. Place member nodes around their hub
		nodesRef.current = data.nodes.map((n) => {
			let x: number, y: number;
			if (hubIds.has(n.id)) {
				const pos = hubPositions.get(n.id)!;
				x = pos.x;
				y = pos.y;
			} else {
				const hid = hubAssign.get(n.id) ?? hubList[0];
				const hpos = hubPositions.get(hid)!;
				const members = hubMembers.get(hid) ?? [];
				const idx = members.indexOf(n.id);
				const total = members.length;
				const clusterRadius = 30 + total * 4;
				const angle = (2 * Math.PI * idx) / Math.max(total, 1);
				const ring = 0.5 + (idx % 3) * 0.25;
				x = hpos.x + Math.cos(angle) * clusterRadius * ring;
				y = hpos.y + Math.sin(angle) * clusterRadius * ring;
			}
			return {
				...n,
				x, y, vx: 0, vy: 0,
				r: Math.max(3, Math.min(20, 3 + n.links * 1.5)),
			};
		});
		edgesRef.current = data.edges;

		// 5. Refine layout: push apart overlapping nodes, keep clusters together
		const nodeMap = new Map<string, Node>();
		const nodes = nodesRef.current;
		for (const nd of nodes) nodeMap.set(nd.id, nd);

		let cooling = 1;
		for (let iter = 0; iter < 200; iter++) {
			if (cooling < 0.005) break;

			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					const a = nodes[i];
					const b = nodes[j];
					let dx = b.x - a.x;
					let dy = b.y - a.y;
					const dist = Math.sqrt(dx * dx + dy * dy) || 1;
					if (dist > 300) continue;
					const repulsion = (800 * cooling) / (dist * dist);
					dx *= repulsion / dist;
					dy *= repulsion / dist;
					if (!hubIds.has(a.id)) { a.vx -= dx; a.vy -= dy; }
					if (!hubIds.has(b.id)) { b.vx += dx; b.vy += dy; }
				}
			}

			for (const e of data.edges) {
				const s = nodeMap.get(e.source);
				const t = nodeMap.get(e.target);
				if (!s || !t) continue;
				let dx = t.x - s.x;
				let dy = t.y - s.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				const restLen = (hubIds.has(s.id) || hubIds.has(t.id)) ? 150 : 60;
				const force = (dist - restLen) * 0.008 * cooling;
				dx = (dx / dist) * force;
				dy = (dy / dist) * force;
				if (!hubIds.has(s.id)) { s.vx += dx; s.vy += dy; }
				if (!hubIds.has(t.id)) { t.vx -= dx; t.vy -= dy; }
			}

			for (const nd of nodes) {
				if (hubIds.has(nd.id)) continue;
				const hid = hubAssign.get(nd.id);
				if (!hid) continue;
				const hpos = hubPositions.get(hid);
				if (!hpos) continue;
				nd.vx += (hpos.x - nd.x) * 0.002 * cooling;
				nd.vy += (hpos.y - nd.y) * 0.002 * cooling;
			}

			for (const nd of nodes) {
				if (hubIds.has(nd.id)) continue;
				nd.vx *= 0.8;
				nd.vy *= 0.8;
				nd.x += nd.vx;
				nd.y += nd.vy;
			}

			cooling *= 0.97;
		}

		panRef.current = { x: 0, y: 0 };
		zoomRef.current = 1;
	}, [data]);

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.parentElement?.getBoundingClientRect();
		const w = rect?.width ?? 800;
		const h = rect?.height ?? 600;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width = `${w}px`;
		canvas.style.height = `${h}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const nodes = nodesRef.current;
		const edges = edgesRef.current;
		const zoom = zoomRef.current;
		const pan = panRef.current;
		const hov = hoveredRef.current;

		const nodeMap = new Map<string, Node>();
		for (const n of nodes) nodeMap.set(n.id, n);

		const hoveredEdges = new Set<string>();
		const hoveredNodes = new Set<string>();
		if (hov) {
			hoveredNodes.add(hov);
			for (const e of edges) {
				if (e.source === hov || e.target === hov) {
					hoveredEdges.add(`${e.source}->${e.target}`);
					hoveredNodes.add(e.source);
					hoveredNodes.add(e.target);
				}
			}
		}

		ctx.clearRect(0, 0, w, h);
		ctx.save();
		ctx.translate(pan.x, pan.y);
		ctx.scale(zoom, zoom);

		for (const e of edges) {
			const s = nodeMap.get(e.source);
			const t = nodeMap.get(e.target);
			if (!s || !t) continue;
			const key = `${e.source}->${e.target}`;
			const isHL = hov ? hoveredEdges.has(key) : false;
			ctx.beginPath();
			ctx.moveTo(s.x, s.y);
			ctx.lineTo(t.x, t.y);
			ctx.strokeStyle = isHL ? 'rgba(59,130,246,0.6)' : (hov ? 'rgba(150,150,150,0.08)' : 'rgba(150,150,150,0.2)');
			ctx.lineWidth = isHL ? 1.5 : 0.5;
			ctx.stroke();
		}

		for (const n of nodes) {
			const color = CATEGORY_COLORS[n.category] ?? DEFAULT_COLOR;
			const isHL = hov ? hoveredNodes.has(n.id) : true;
			const alpha = isHL ? 1 : 0.15;

			ctx.beginPath();
			ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
			ctx.fillStyle = color + (alpha < 1 ? '26' : 'ff');
			ctx.fill();
			ctx.strokeStyle = color + (alpha < 1 ? '40' : 'ff');
			ctx.lineWidth = n.id === hov ? 2.5 : 1;
			ctx.stroke();

			if (zoom > 0.5 || isHL) {
				const fontSize = Math.max(8, Math.min(11, 9 / zoom));
				ctx.font = `${n.id === hov ? 'bold ' : ''}${fontSize}px -apple-system, sans-serif`;
				ctx.fillStyle = isHL ? '#333' : 'rgba(0,0,0,0.15)';
				ctx.textAlign = 'center';
				const label = n.title.length > 10 ? n.title.slice(0, 9) + '…' : n.title;
				ctx.fillText(label, n.x, n.y + n.r + fontSize + 1);
			}
		}

		ctx.restore();
	}, []);

	const simulate = useCallback(() => {
		const nodes = nodesRef.current;
		const edges = edgesRef.current;
		if (nodes.length === 0) return;

		if (dragRef.current) {
			const dragId = dragRef.current.nodeId;
			const nodeMap = new Map<string, Node>();
			for (const n of nodes) nodeMap.set(n.id, n);
			const anchor = nodeMap.get(dragId);

			if (anchor) {
				// Collect unique neighbors
				const neighborSet = new Set<string>();
				for (const e of edges) {
					if (e.source === dragId && e.target !== dragId) neighborSet.add(e.target);
					if (e.target === dragId && e.source !== dragId) neighborSet.add(e.source);
				}
				const neighbors = [...neighborSet].map(id => nodeMap.get(id)).filter(Boolean) as Node[];

				// Arrange neighbors in a circle around the dragged node
				const orbitRadius = 60 + neighbors.length * 3;
				for (let i = 0; i < neighbors.length; i++) {
					const angle = (2 * Math.PI * i) / neighbors.length;
					const targetX = anchor.x + Math.cos(angle) * orbitRadius;
					const targetY = anchor.y + Math.sin(angle) * orbitRadius;
					const n = neighbors[i];
					n.x += (targetX - n.x) * 0.08;
					n.y += (targetY - n.y) * 0.08;
				}
			}
		}

		draw();
		frameRef.current = requestAnimationFrame(simulate);
	}, [draw]);

	useEffect(() => {
		frameRef.current = requestAnimationFrame(simulate);
		return () => cancelAnimationFrame(frameRef.current);
	}, [simulate, data]);

	const screenToWorld = useCallback((sx: number, sy: number) => {
		const zoom = zoomRef.current;
		const pan = panRef.current;
		return {
			x: (sx - pan.x) / zoom,
			y: (sy - pan.y) / zoom,
		};
	}, []);

	const findNode = useCallback((sx: number, sy: number): Node | null => {
		const { x, y } = screenToWorld(sx, sy);
		for (let i = nodesRef.current.length - 1; i >= 0; i--) {
			const n = nodesRef.current[i];
			const dx = n.x - x;
			const dy = n.y - y;
			if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
		}
		return null;
	}, [screenToWorld]);

	const handleMouseMove = useCallback((e: React.MouseEvent) => {
		const rect = canvasRef.current?.getBoundingClientRect();
		if (!rect) return;
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;

		if (dragRef.current) {
			const { x, y } = screenToWorld(sx, sy);
			const n = nodesRef.current.find(n => n.id === dragRef.current!.nodeId);
			if (n) {
				n.x = x - dragRef.current.offsetX;
				n.y = y - dragRef.current.offsetY;
				n.vx = 0;
				n.vy = 0;
			}
			return;
		}

		if (panStartRef.current) {
			panRef.current = {
				x: panStartRef.current.px + (e.clientX - panStartRef.current.x),
				y: panStartRef.current.py + (e.clientY - panStartRef.current.y),
			};
			return;
		}

		const node = findNode(sx, sy);
		const id = node?.id ?? null;
		if (id !== hoveredRef.current) {
			hoveredRef.current = id;
			setHovered(id);
		}
	}, [findNode, screenToWorld]);

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		const rect = canvasRef.current?.getBoundingClientRect();
		if (!rect) return;
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const node = findNode(sx, sy);
		if (node) {
			const { x, y } = screenToWorld(sx, sy);
			dragRef.current = { nodeId: node.id, offsetX: x - node.x, offsetY: y - node.y, startX: e.clientX, startY: e.clientY };
		} else {
			panStartRef.current = { x: e.clientX, y: e.clientY, px: panRef.current.x, py: panRef.current.y };
		}
	}, [findNode, screenToWorld]);

	const handleMouseUp = useCallback((e: React.MouseEvent) => {
		if (dragRef.current) {
			const dx = e.clientX - dragRef.current.startX;
			const dy = e.clientY - dragRef.current.startY;
			const wasDrag = Math.abs(dx) > 5 || Math.abs(dy) > 5;
			const nodeId = dragRef.current.nodeId;
			dragRef.current = null;
			if (!wasDrag) {
				onSelectNode(nodeId);
			}
			return;
		}
		if (panStartRef.current) {
			const dx = e.clientX - panStartRef.current.x;
			const dy = e.clientY - panStartRef.current.y;
			panStartRef.current = null;
			if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
				const rect = canvasRef.current?.getBoundingClientRect();
				if (rect) {
					const node = findNode(e.clientX - rect.left, e.clientY - rect.top);
					if (node) onSelectNode(node.id);
				}
			}
		}
	}, [findNode, onSelectNode, screenToWorld]);

	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		const rect = canvasRef.current?.getBoundingClientRect();
		if (!rect) return;
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const oldZoom = zoomRef.current;
		const factor = e.deltaY < 0 ? 1.1 : 0.9;
		const newZoom = Math.max(0.1, Math.min(5, oldZoom * factor));
		panRef.current = {
			x: sx - ((sx - panRef.current.x) / oldZoom) * newZoom,
			y: sy - ((sy - panRef.current.y) / oldZoom) * newZoom,
		};
		zoomRef.current = newZoom;
	}, []);

	return (
		<div className="relative w-full h-full">
			<canvas
				ref={canvasRef}
				className="w-full h-full"
				style={{ cursor: hovered ? 'pointer' : dragRef.current ? 'grabbing' : 'grab' }}
				onMouseMove={handleMouseMove}
				onMouseDown={handleMouseDown}
				onMouseUp={handleMouseUp}
				onMouseLeave={() => {
					dragRef.current = null;
					panStartRef.current = null;
					hoveredRef.current = null;
					setHovered(null);
				}}
				onWheel={handleWheel}
			/>
			{/* Legend */}
			<div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-[10px] bg-background/80 backdrop-blur-sm rounded-md px-2 py-1.5 border">
				{Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
					<div key={cat} className="flex items-center gap-1">
						<span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
						<span>{cat}</span>
					</div>
				))}
			</div>
		</div>
	);
};
