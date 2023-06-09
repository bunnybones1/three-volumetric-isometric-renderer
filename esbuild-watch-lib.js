import { build } from "esbuild";
import { glsl } from "esbuild-plugin-glsl";
import { nodeExternalsPlugin }  from 'esbuild-node-externals'
import { typecheckPlugin } from '@jgoz/esbuild-plugin-typecheck'

build({
    entryPoints: ['src/index.ts'],
    outdir: 'lib',
    bundle: true,
    sourcemap: true,
    minify: false,
    splitting: false,
    format: 'esm',
    target: ['esnext'],
    tsconfig: './tsconfig.module.json',
    plugins: [
        typecheckPlugin(),
        glsl({
            minify: false
        }),
        nodeExternalsPlugin()
    ],
    watch: true
})
.catch(() => process.exit(1));

