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

export class CsoundModuleLoader {
  #factory: CsoundFactory | null = null;
  #pending: Promise<CsoundFactory> | null = null;
  readonly #importModule: CsoundModuleImporter;

  constructor(
    importModule: CsoundModuleImporter = async () => {
      const [module, response] = await Promise.all([
        import("@csound/browser"),
        fetch(new URL("./plugins/hlolli_wg_piano.wasm", document.baseURI)),
      ]);
      if (!response.ok) {
        throw new Error(`Could not load hlolli_wg_piano (HTTP ${response.status}).`);
      }
      const piano = await response.arrayBuffer();
      return {
        default: async (options) => {
          // The worker host accepts plugin URLs; its published types say object[].
          const url = URL.createObjectURL(new Blob([piano], { type: "application/wasm" }));
          try {
            return await module.default({ ...options, withPlugins: [url] as unknown as object[] });
          } finally {
            URL.revokeObjectURL(url);
          }
        },
      };
    },
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
      return this.preload().then((factory) => factory(options));
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
