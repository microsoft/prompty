import { create } from "zustand";

export interface Time {
  start: string;
  end: string;
  duration: number;
}

export interface Usage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
}

export interface TraceItem {
  id?: string;
  name: string;
  signature: string;
  description?: string;
  type?: string;
  inputs: object;
  result: object;
  __time: Time;
  __usage?: Usage;
  __frames?: TraceItem[];
}

export interface Trace {
  runtime: string;
  version: string;
  trace: TraceItem;
}

export interface TraceState {
  trace: Trace | undefined;
  setTrace: (trace: Trace) => void;
}

export const useTraceStore = create<TraceState>()((set) => ({
  trace: undefined,
  setTrace: (trace: Trace) => set({ trace }),
}));

export interface CurrentTraceState {
  traceItem: TraceItem | undefined;
  setTraceItem: (traceItem: TraceItem) => void;
}

export const useCurrentStore = create<CurrentTraceState>()((set) => ({
  traceItem: undefined,
  setTraceItem: (traceItem: TraceItem) => set({ traceItem }),
}));

export interface ModalState {
  title: string;
  children: React.ReactNode;
}

export interface ModalCollectionState {
  modals: ModalState[];
  pushModal: (modal: ModalState) => void;
  popModal: () => void;
  isEmpty: boolean;
  closeAll: () => void;
}

export const useModalStore = create<ModalCollectionState>()((set) => ({
  modals: [],
  isEmpty: true,
  pushModal: (modal: ModalState) => set((state) => ({ 
    modals: [...state.modals, modal],
    isEmpty: false,
  })),
  popModal: () => set((state) => ({ 
    modals: state.modals.length > 0 ? state.modals.slice(0, -1) : [],
    isEmpty: state.modals.length === 1,
  })),
  closeAll: () => set({ modals: [], isEmpty: true }),
}));
