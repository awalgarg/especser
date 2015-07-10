System.config({
  "baseURL": "/",
  "transpiler": "babel",
  "babelOptions": {
    "optional": [
      "runtime"
    ],
    "blacklist": [
      "asyncToGenerator",
      "bluebirdCoroutines",
      "es3.memberExpressionLiterals",
      "es3.propertyLiterals",
      "es5.properties.mutators",
      // "es6.arrowFunctions",
      // "es6.blockScoping",
      // "es6.classes",
      // "es6.constants",
      // "es6.destructuring",
      // "es6.forOf",
      // "es6.modules",
      // "es6.objectSuper",
      // "es6.parameters.default",
      // "es6.parameters.rest",
      // "es6.properties.computed",
      // "es6.properties.shorthand",
      "es6.regex.sticky",
      "es6.regex.unicode",
      // "es6.spec.blockScoping",
      "es6.spec.symbols",
      // "es6.spec.templateLiterals",
      // "es6.spread",
      // "es6.tailCall",
      // "es6.templateLiterals",
      "es7.asyncFunctions",
      "es7.classProperties",
      "es7.comprehensions",
      "es7.decorators",
      "es7.doExpressions",
      "es7.exponentiationOperator",
      "es7.exportExtensions",
      "es7.objectRestSpread",
      "es7.trailingFunctionCommas",
      "flow",
      "jscript",
      // "ludicrous",
      "minification.deadCodeElimination",
      // "minification.memberExpressionLiterals",
      // "minification.propertyLiterals",
      "optimisation.flow.forOf",
      "optimisation.react.constantElements",
      "optimisation.react.inlineElements",
      "react",
      "reactCompat",
      // "regenerator",
      // "runtime",
      "spec.blockScopedFunctions",
      "spec.functionName",
      "spec.protoToAssign",
      "spec.undefinedToVoid",
      "strict",
      "utility.inlineEnvironmentVariables",
      "minification.constantFolding",
      // "utility.removeConsole",
      "minification.removeDebugger",
      "validation.react",
      "validation.undeclaredVariableCheck"
    ]
  },
  "paths": {
    "*": "*.js",
    "github:*": "jspm_packages/github/*.js",
    "npm:*": "jspm_packages/npm/*.js"
  }
});

System.config({
  "map": {
    "babel": "npm:babel-core@5.5.8",
    "babel-runtime": "npm:babel-runtime@5.5.8",
    "core-js": "npm:core-js@0.9.18",
    "fetch": "github:github/fetch@0.9.0",
    "less": "github:aaike/jspm-less-plugin@0.0.5",
    "localforage": "npm:localforage@1.2.3",
    "github:aaike/jspm-less-plugin@0.0.5": {
      "less.js": "github:distros/less@2.4.0"
    },
    "github:jspm/nodelibs-path@0.1.0": {
      "path-browserify": "npm:path-browserify@0.0.0"
    },
    "github:jspm/nodelibs-process@0.1.1": {
      "process": "npm:process@0.10.1"
    },
    "npm:asap@1.0.0": {
      "process": "github:jspm/nodelibs-process@0.1.1"
    },
    "npm:babel-runtime@5.5.8": {
      "process": "github:jspm/nodelibs-process@0.1.1"
    },
    "npm:core-js@0.9.18": {
      "fs": "github:jspm/nodelibs-fs@0.1.2",
      "process": "github:jspm/nodelibs-process@0.1.1",
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "npm:localforage@1.2.3": {
      "path": "github:jspm/nodelibs-path@0.1.0",
      "process": "github:jspm/nodelibs-process@0.1.1",
      "promise": "npm:promise@5.0.0"
    },
    "npm:path-browserify@0.0.0": {
      "process": "github:jspm/nodelibs-process@0.1.1"
    },
    "npm:promise@5.0.0": {
      "asap": "npm:asap@1.0.0"
    }
  }
});

