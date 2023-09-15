import { exists, mkdir, rm } from "fs/promises";
import { dirname } from "path";
import svelte from "rollup-plugin-svelte";
import * as vite from "vite";
import { dlopen, FFIType, suffix } from "bun:ffi";

/**
 *
 * @param {string} fileName
 * @param {"ssr","dom"} generate
 * @param {string} outDir
 * @returns
 */
async function bundle(fileName, generate, outDir) {
  const lib = {};
  if (generate === "dom") {
    lib["formats"] = ["es"];
  }

  const output = {};
  if (generate === "dom") {
    output["format"] = "es";
  }

  return await vite.build({
    build: {
      outDir,
      lib: {
        entry: fileName,
        name: "app",
        formats: ["cjs"],
        ...lib,
      },
      rollupOptions: {
        output: {
          entryFileNames: `[name].js`,
          chunkFileNames: `[name]-[hash].js`,
          assetFileNames: `[name].[ext]`,
          format: "esm",
          ...output,
        },
        plugins: [
          svelte({
            compilerOptions: {
              generate,
            },
          }),
        ],
      },
      sourcemap: false,
    },
  });
}

/**
 * @typedef SSRRenderResult
 * @property {string} head
 * @property {string} html
 * @property {{code:string,map?:string}} css
 */

/**
 * @callback SSRRender
 * @param {Record<string, any>} options
 * @returns {SSRRenderResult}
 */

/**
 * @typedef SSRComponent
 * @property {Render} render
 */

/**
 * @typedef DOMComponent
 */

/**
 * @typedef Resolver
 * @property {SSRComponent} ssr
 * @property {string} src
 * @property {Record<string, any>} parameters
 */

/**
 * @typedef SourceLocation
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef Attribute
 * @property {number} start
 * @property {number} end
 * @property {string} type
 * @property {string} name
 * @property {Array<Path|Component>} value
 */

/**
 * @typedef ComponentExpression
 * @property {number} start
 * @property {number} end
 * @property {string} type
 * @property {SourceLocation} loc
 */

/**
 * @typedef Path
 * @property {number} start
 * @property {number} end
 * @property {string} type
 * @property {string} raw
 * @property {any} data
 */

/**
 * @typedef Component
 * @property {number} start
 * @property {number} end
 * @property {string} type
 * @property {ComponentExpression} expression
 * @property {string} name
 */

/**
 *
 * @param {Request} request
 * @returns
 */
function findRequestPath(request) {
  const path =
    "/" +
    request.url
      .replace(/^.*:\/\//, "")
      .split("/")
      .slice(1)
      .join("/");

  if (path === "/") {
    return "/index.svelte";
  }

  return path;
}

/**
 * Load and compile a svelte file for ssr.
 * @param {string} path
 * @param {Record<string, any>} path
 * @returns {Promise<SSRComponent>}
 */
async function createResolverFromFileName(path, parameters = {}) {
  // if (cache.has(path)) {
  //   return cache.get(path);
  // }

  const svelteFile = Bun.file(`./www${path}`);
  const javaScriptFileDOM = Bun.file(
    `./.dom${path.replace(/\.[^.]+$/, "")}.js`.replaceAll(/\/\.+\//g, "/"),
  );
  const javaScriptFileSSR = Bun.file(
    `./.ssr${path.replace(/\.[^.]+$/, "")}.js`.replaceAll(/\/\.+\//g, "/"),
  );

  const dirNameDOM = dirname(javaScriptFileDOM.name);
  const dirNameSSR = dirname(javaScriptFileSSR.name);

  await mkdir(dirNameDOM, {
    recursive: true,
  });

  await mkdir(dirNameSSR, {
    recursive: true,
  });

  // ---- saving .ssr ----
  await bundle(svelteFile.name, "ssr", "./.ssr");

  // ---- saving .dom ----
  await mkdir(dirname(javaScriptFileDOM.name), { recursive: true });
  await bundle(svelteFile.name, "dom", "./.dom");

  const resultOfSSR = (await import(javaScriptFileSSR.name)).default;
  const resultOfSRC = path.replace(/\.[^.]+$/, ".js");

  cache.set(path, { ssr: resultOfSSR, src: resultOfSRC });

  return {
    ssr: resultOfSSR,
    src: resultOfSRC,
    parameters,
  };
}

/**
 *
 * @param {Resolver} resolver
 * @param {Record<string, any>} parameters
 */
function render(resolver) {
  const result = resolver.ssr.render(resolver.parameters);
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        ${result.head ?? ""}
        <style>${result.css?.code ?? ""}</style>
        <script defer type="module">
          import Application from '${resolver.src}'
          document.body.innerText = ''
          new Application({target: document.body, props: ${JSON.stringify(
            resolver.parameters,
          )}})
        </script>
    </head>
    <body>
        ${result.html ?? ""}
    </body>
    </html>
    `;
}

/** @type {Map<string, {ssr:any,dom:string}>} */
const cache = new Map();

if (await exists(".ssr")) {
  await rm(".ssr", { recursive: true });
}
await mkdir(".ssr", { recursive: true });

if (exists(".dom")) {
  rm(".dom", { recursive: true });
}
mkdir(".dom", { recursive: true });

console.log("Launching server at http://127.0.0.1:8080/index.svelte");

const path = `libmain.${suffix}`;

const lib = dlopen(path, {
  hello: {
    args: [],
    returns: "cstring",
  },
});

Bun.serve({
  port: 8080,
  async fetch(request) {
    const fileName = findRequestPath(request);
    if (!fileName.endsWith(".svelte")) {
      const domFile = Bun.file(`./.dom${fileName}`);
      if (await domFile.exists()) {
        return new Response(domFile);
      }

      const wwwFileName = Bun.file(`./www${fileName}`);
      if (await wwwFileName.exists()) {
        return new Response(wwwFileName);
      }

      return;
    }

    /** @type {Resolver} */
    const resolver = await createResolverFromFileName(fileName, {
      message: lib.symbols.hello(),
    });
    if (!resolver) {
      return;
    }
    const content = render(resolver);
    return new Response(content, {
      headers: {
        "content-type": "text/html",
      },
    });
  },
});
