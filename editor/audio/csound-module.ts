import type { CsoundObj } from "@csound/browser";

export type CsoundCreateOptions = {
  autoConnect: false;
  useWorker: true;
  useSAB: false;
};

export type CsoundFactory = (
  options: CsoundCreateOptions,
) => Promise<CsoundObj | undefined>;

export type CsoundModuleImporter = () => Promise<{
  default: CsoundFactory;
}>;

const loadingMessage =
  "Csound is still loading. Wait a moment, then press Play again.";

export class CsoundModuleLoader {
  #factory: CsoundFactory | null = null;
  #pending: Promise<CsoundFactory> | null = null;
  readonly #importModule: CsoundModuleImporter;

  constructor(
    importModule: CsoundModuleImporter = () => import("@csound/browser"),
  ) {
    this.#importModule = importModule;
  }

  get ready() {
    return this.#factory !== null;
  }

  preload() {
    if (this.#factory) {
      return Promise.resolve(this.#factory);
    }
    if (this.#pending) {
      return this.#pending;
    }

    this.#pending = this.#importModule()
      .then((module) => {
        this.#factory = module.default;
        return module.default;
      })
      .catch((error) => {
        this.#pending = null;
        throw error;
      });
    return this.#pending;
  }

  create(options: CsoundCreateOptions) {
    if (!this.#factory) {
      void this.preload().catch(() => {
        // The next Play attempt reports another load failure and can retry.
      });
      throw new Error(loadingMessage);
    }
    return this.#factory(options);
  }
}

const defaultLoader = new CsoundModuleLoader();

export function preloadCsoundModule() {
  return defaultLoader.preload();
}

export function createPreloadedCsound(options: CsoundCreateOptions) {
  return defaultLoader.create(options);
}
