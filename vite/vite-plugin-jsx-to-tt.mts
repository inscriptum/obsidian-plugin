import { transform } from "@babel/core";
import jsxToTt from "babel-plugin-transform-jsx-to-tt";
import type { Plugin } from "vite";

const svgPathRe = /svgnode/;

export function jsxToTtPlugin(): Plugin {
  return {
    name: "jsx-to-tt",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".tsx")) {
        return;
      }

      const isSvg = svgPathRe.test(id);
      const result = transform(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: ["@babel/preset-typescript"],
        plugins: [
          [
            jsxToTt,
            isSvg
              ? {
                  tag: "svg",
                  import: { module: "lit-html", export: "svg" },
                  attributes: [
                    {
                      prefix: "",
                      attributes: [
                        "viewBox",
                        "transform",
                        "points",
                        "markerStart",
                        "markerEnd",
                        "points",
                        "fill",
                        "stroke",
                        "strokeWidth",
                        "d",
                        "width",
                        "height",
                        "x",
                        "y",
                        "href",
                      ],
                    },
                    { preset: "lit-html" },
                  ],
                }
              : {
                  tag: "html",
                  import: { module: "lit-html", export: "html" },
                  attributes: [{ preset: "lit-html" }],
                },
          ],
        ],
      });

      return result
        ? { code: result.code ?? "", map: result.map as any }
        : undefined;
    },
  };
}
