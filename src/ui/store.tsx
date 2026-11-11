// One place for everything the three views share: the machines, the bid board, the loan, the stress, prices and records.
// Every dollar is recomputed by the engine on each change; this file only holds inputs and talks to the server.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { gradeRisk, underwrite } from '../lib/engine';
import type {
  Analysis, Asset, AssetKind, Assumptions, Bid, BidBook, BidInput, LeadInput, LoanTerms, PriceFeed, RiskGrade, Stress, Underwriting,
} from '../lib/types';
import {
  assumptions as sampleAssumptions, gpuBids, gpuCluster, loanTerms, noStress, robotBids, robotLoanTerms, weldingRobot,
} from '../data/samples';

type ByKind<T> = Record<AssetKind, T>;
const SAMPLE_ASSETS: ByKind<Asset> = { gpu: gpuCluster, robot: weldingRobot };
const SAMPLE_BIDS: ByKind<Bid[]> = { gpu: gpuBids, robot: robotBids };
const SAMPLE_LOANS: ByKind<LoanTerms> = { gpu: loanTerms, robot: robotLoanTerms };
const TOKEN_KEY = 'bid-tokens';
const LOCAL = 'local';

function readTokens(): Record<string, string> {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}') as unknown;
    return t && typeof t === 'object' ? (t as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeTokens(t: Record<string, string>) {
  try {
    const kept = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== LOCAL));
    localStorage.setItem(TOKEN_KEY, JSON.stringify(kept));
  } catch {
    // Storage blocked: the bid can still be removed during this visit.
  }
}

function errorText(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const d = data as { error?: unknown; message?: unknown };
    if (typeof d.error === 'string' && d.error) return d.error;
    if (typeof d.message === 'string' && d.message) return d.message;
  }
  return fallback;
}

/** 'shared': the server's bid board. 'local': the board is unreachable, so bids live in this browser only. */
export type BoardMode = 'loading' | 'shared' | 'local';
export type LoadState = 'idle' | 'loading' | 'error';

export interface Store {
  kind: AssetKind;
  setKind: (k: AssetKind) => void;
  asset: Asset;
  bids: Bid[];
  loan: LoanTerms;
  assumptions: Assumptions;
  stress: Stress;
  u: Underwriting;
  patchAsset: (p: Partial<Asset>) => void;
  patchLoan: (p: Partial<LoanTerms>) => void;
  patchStress: (p: Partial<Stress>) => void;
  setChipMonth: (m: number | null) => void;
  resetAssumptions: () => void;
  board: BoardMode;
  ownBid: (id: string) => boolean;
  postBid: (b: Omit<BidInput, 'asset'>) => Promise<Bid>;
  removeBid: (id: string) => Promise<void>;
  prices: PriceFeed | null;
  pricesFailed: boolean;
  analysis: Analysis | null;
  analysisLoad: LoadState;
  analysisError: string;
  readSampleRecords: () => void;
  readRecordsFile: (f: File) => void;
  grade: RiskGrade | null;
  gradeWithoutBids: RiskGrade | null;
  sendLead: (l: LeadInput) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore needs StoreProvider');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<AssetKind>('gpu');
  const [assets, setAssets] = useState(SAMPLE_ASSETS);
  const [loans, setLoans] = useState(SAMPLE_LOANS);
  const [books, setBooks] = useState(SAMPLE_BIDS);
  const [stressBase, setStressBase] = useState<Stress>(noStress);
  const [board, setBoard] = useState<BoardMode>('loading');
  const [tokens, setTokens] = useState<Record<string, string>>(readTokens);
  const assumptions = sampleAssumptions;

  const asset = assets[kind];
  const loan = loans[kind];
  const bids = books[kind];
  const stress = useMemo<Stress>(
    () => ({ ...stressBase, chipShipsMonth: stressBase.chipShipsMonth === null ? null : Math.min(stressBase.chipShipsMonth, loan.months) }),
    [stressBase, loan.months],
  );
  const u = useMemo(() => underwrite(asset, bids, loan, assumptions, stress), [asset, bids, loan, assumptions, stress]);

  // --- the shared bid board -------------------------------------------------------------------------------------
  const refreshBoard = useCallback(async (k: AssetKind) => {
    try {
      const r = await fetch(`/api/bids?asset=${k}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const book = (await r.json()) as BidBook;
      if (!book || !Array.isArray(book.bids)) throw new Error('unexpected board');
      setBooks((s) => (JSON.stringify(s[k]) === JSON.stringify(book.bids) ? s : { ...s, [k]: book.bids }));
      setBoard('shared');
    } catch {
      setBoard((b) => (b === 'shared' ? 'shared' : 'local'));
    }
  }, []);

  useEffect(() => {
    void refreshBoard(kind);
    const t = window.setInterval(() => void refreshBoard(kind), 10_000);
    return () => window.clearInterval(t);
  }, [kind, refreshBoard]);

  const postBid = useCallback(
    async (b: Omit<BidInput, 'asset'>): Promise<Bid> => {
      if (board === 'shared') {
        const r = await fetch('/api/bids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...b, asset: kind }),
        });
        const data = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (!r.ok || !data) throw new Error(errorText(data, 'Could not post the bid. Try again.'));
        const raw = (data.bid ?? data) as Bid & { token?: string };
        const token = (typeof data.token === 'string' ? data.token : raw.token) as string | undefined;
        const { token: _secret, ...bid } = raw;
        if (token) {
          setTokens((t) => {
            const next = { ...t, [bid.id]: token };
            writeTokens(next);
            return next;
          });
        }
        setBooks((s) => ({ ...s, [kind]: [...s[kind].filter((x) => x.id !== bid.id), bid] }));
        return bid;
      }
      const bid: Bid = {
        id: `local-${Date.now().toString(36)}`,
        buyer: b.buyer,
        units: b.units,
        pricePerUnit: b.pricePerUnit,
        validThroughMonth: b.validThroughMonth,
        fundedPct: 1,
        postedAt: new Date().toISOString(),
      };
      setTokens((t) => ({ ...t, [bid.id]: LOCAL }));
      setBooks((s) => ({ ...s, [kind]: [...s[kind], bid] }));
      return bid;
    },
    [board, kind],
  );

  const removeBid = useCallback(
    async (id: string) => {
      const token = tokens[id];
      if (!token) return;
      if (token !== LOCAL) {
        const r = await fetch(`/api/bids/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-bid-token': token } });
        if (!r.ok && r.status !== 404) throw new Error('Could not remove the bid.');
      }
      setTokens((t) => {
        const next = { ...t };
        delete next[id];
        writeTokens(next);
        return next;
      });
      setBooks((s) => ({ ...s, [kind]: s[kind].filter((x) => x.id !== id) }));
    },
    [tokens, kind],
  );

  const ownBid = useCallback((id: string) => Boolean(tokens[id]), [tokens]);

  // --- live prices ----------------------------------------------------------------------------------------------
  const [prices, setPrices] = useState<PriceFeed | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/prices');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const feed = (await r.json()) as PriceFeed;
        if (!feed?.reference) throw new Error('unexpected feed');
        if (alive) {
          setPrices(feed);
          setPricesFailed(false);
        }
      } catch {
        if (alive) setPricesFailed(true);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // --- the records ----------------------------------------------------------------------------------------------
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoad, setAnalysisLoad] = useState<LoadState>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const analyze = useCallback(async (body: { csv?: string }) => {
    setAnalysisLoad('loading');
    setAnalysisError('');
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await r.json().catch(() => null)) as Analysis | null;
      if (!r.ok || !data || !Array.isArray(data.flags) || !data.summary) throw new Error(errorText(data, 'Could not read those records.'));
      setAnalysis(data);
      setAnalysisLoad('idle');
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : 'Could not read those records.');
      setAnalysisLoad('error');
    }
  }, []);
  const readSampleRecords = useCallback(() => void analyze({}), [analyze]);
  const readRecordsFile = useCallback(
    (f: File) => {
      if (f.size > 2_000_000) {
        setAnalysisError('That file is over 2 MB.');
        setAnalysisLoad('error');
        return;
      }
      f.text().then(
        (csv) => analyze({ csv }),
        () => {
          setAnalysisError('Could not open that file.');
          setAnalysisLoad('error');
        },
      );
    },
    [analyze],
  );

  const grade = useMemo(
    () => (analysis && kind === 'gpu' ? gradeRisk(asset, analysis.summary, bids.length > 0, loan.months) : null),
    [analysis, kind, asset, bids.length, loan.months],
  );
  const gradeWithoutBids = useMemo(
    () => (analysis && kind === 'gpu' && bids.length > 0 ? gradeRisk(asset, analysis.summary, false, loan.months) : null),
    [analysis, kind, asset, bids.length, loan.months],
  );

  // --- someone asking for this on their own machines ------------------------------------------------------------
  const sendLead = useCallback(async (l: LeadInput) => {
    const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l) });
    const data = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    if (!r.ok || !data?.ok) throw new Error(errorText(data, 'Could not send. Try again in a minute.'));
  }, []);

  // --- inputs ---------------------------------------------------------------------------------------------------
  const patchAsset = useCallback((p: Partial<Asset>) => setAssets((s) => ({ ...s, [kind]: { ...s[kind], ...p } })), [kind]);
  const patchLoan = useCallback((p: Partial<LoanTerms>) => setLoans((s) => ({ ...s, [kind]: { ...s[kind], ...p } })), [kind]);
  const patchStress = useCallback((p: Partial<Stress>) => setStressBase((s) => ({ ...s, ...p })), []);
  const setChipMonth = useCallback((m: number | null) => setStressBase((s) => ({ ...s, chipShipsMonth: m })), []);
  const resetAssumptions = useCallback(() => {
    setAssets((s) => ({ ...s, [kind]: SAMPLE_ASSETS[kind] }));
    setLoans((s) => ({ ...s, [kind]: SAMPLE_LOANS[kind] }));
    setStressBase((s) => ({ ...noStress, chipShipsMonth: s.chipShipsMonth }));
  }, [kind]);

  const store: Store = {
    kind, setKind, asset, bids, loan, assumptions, stress, u,
    patchAsset, patchLoan, patchStress, setChipMonth, resetAssumptions,
    board, ownBid, postBid, removeBid,
    prices, pricesFailed,
    analysis, analysisLoad, analysisError, readSampleRecords, readRecordsFile, grade, gradeWithoutBids,
    sendLead,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
