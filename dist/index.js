(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0, l = deps.length; i < l; i++)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  function register(name, deps, declare, execute) {
    if (typeof name != 'string')
      throw "System.register provided no module name";

    var entry;

    // dynamic
    if (typeof declare == 'boolean') {
      entry = {
        declarative: false,
        deps: deps,
        execute: execute,
        executingRequire: declare
      };
    }
    else {
      // ES6 declarative
      entry = {
        declarative: true,
        deps: deps,
        declare: declare
      };
    }

    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry; 

    entry.deps = dedupe(entry.deps);

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }

  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;
      exports[name] = value;

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          var importerIndex = indexOf.call(importerModule.dependencies, module);
          importerModule.setters[importerIndex](exports);
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    if (!module.setters || !module.execute)
      throw new TypeError("Invalid System.register form for " + entry.name);

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        if (depEntry.module.exports && depEntry.module.exports.__esModule)
          depExports = depEntry.module.exports;
        else
          depExports = { 'default': depEntry.module.exports, __useDefault: true };
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    var module = entry.module.exports;

    if (!module || !entry.declarative && module.__esModule !== true)
      module = { 'default': module, __useDefault: true };

    // return the defined module object
    return modules[name] = module;
  };

  return function(mains, declare) {

    var System;
    var System = {
      register: register, 
      get: load, 
      set: function(name, module) {
        modules[name] = module; 
      },
      newModule: function(module) {
        return module;
      },
      global: global 
    };
    System.set('@empty', {});

    declare(System);

    for (var i = 0; i < mains.length; i++)
      load(mains[i]);
  }

})(typeof window != 'undefined' ? window : global)
/* (['mainModule'], function(System) {
  System.register(...);
}); */

(['src/index'], function(System) {

(function() {
function define(){};  define.amd = {};
!function(e) {
  if ("object" == typeof exports && "undefined" != typeof module)
    module.exports = e();
  else if ("function" == typeof define && define.amd)
    System.register("github:distros/less@2.4.0/less", [], false, function(__require, __exports, __module) {
      return (e).call(this);
    });
  else {
    var f;
    "undefined" != typeof window ? f = window : "undefined" != typeof global ? f = global : "undefined" != typeof self && (f = self), f.less = e();
  }
}(function() {
  var define,
      module,
      exports;
  return (function e(t, n, r) {
    function s(o, u) {
      if (!n[o]) {
        if (!t[o]) {
          var a = typeof require == "function" && require;
          if (!u && a)
            return a(o, !0);
          if (i)
            return i(o, !0);
          var f = new Error("Cannot find module '" + o + "'");
          throw f.code = "MODULE_NOT_FOUND", f;
        }
        var l = n[o] = {exports: {}};
        t[o][0].call(l.exports, function(e) {
          var n = t[o][1][e];
          return s(n ? n : e);
        }, l, l.exports, e, t, n, r);
      }
      return n[o].exports;
    }
    var i = typeof require == "function" && require;
    for (var o = 0; o < r.length; o++)
      s(r[o]);
    return s;
  })({
    1: [function(require, module, exports) {
      var addDataAttr = require("./utils").addDataAttr,
          browser = require("./browser");
      module.exports = function(window, options) {
        addDataAttr(options, browser.currentScript(window));
        if (options.isFileProtocol === undefined) {
          options.isFileProtocol = /^(file|(chrome|safari)(-extension)?|resource|qrc|app):/.test(window.location.protocol);
        }
        options.async = options.async || false;
        options.fileAsync = options.fileAsync || false;
        options.poll = options.poll || (options.isFileProtocol ? 1000 : 1500);
        options.env = options.env || (window.location.hostname == '127.0.0.1' || window.location.hostname == '0.0.0.0' || window.location.hostname == 'localhost' || (window.location.port && window.location.port.length > 0) || options.isFileProtocol ? 'development' : 'production');
        var dumpLineNumbers = /!dumpLineNumbers:(comments|mediaquery|all)/.exec(window.location.hash);
        if (dumpLineNumbers) {
          options.dumpLineNumbers = dumpLineNumbers[1];
        }
        if (options.useFileCache === undefined) {
          options.useFileCache = true;
        }
        if (options.onReady === undefined) {
          options.onReady = true;
        }
      };
    }, {
      "./browser": 3,
      "./utils": 9
    }],
    2: [function(require, module, exports) {
      require('promise/polyfill.js');
      var options = window.less || {};
      require("./add-default-options")(window, options);
      var less = module.exports = require("./index")(window, options);
      if (options.onReady) {
        if (/!watch/.test(window.location.hash)) {
          less.watch();
        }
        less.pageLoadFinished = less.registerStylesheets().then(function() {
          return less.refresh(less.env === 'development');
        });
      }
    }, {
      "./add-default-options": 1,
      "./index": 7,
      "promise/polyfill.js": "promise/polyfill.js"
    }],
    3: [function(require, module, exports) {
      var utils = require("./utils");
      module.exports = {
        createCSS: function(document, styles, sheet) {
          var href = sheet.href || '';
          var id = 'less:' + (sheet.title || utils.extractId(href));
          var oldStyleNode = document.getElementById(id);
          var keepOldStyleNode = false;
          var styleNode = document.createElement('style');
          styleNode.setAttribute('type', 'text/css');
          if (sheet.media) {
            styleNode.setAttribute('media', sheet.media);
          }
          styleNode.id = id;
          if (!styleNode.styleSheet) {
            styleNode.appendChild(document.createTextNode(styles));
            keepOldStyleNode = (oldStyleNode !== null && oldStyleNode.childNodes.length > 0 && styleNode.childNodes.length > 0 && oldStyleNode.firstChild.nodeValue === styleNode.firstChild.nodeValue);
          }
          var head = document.getElementsByTagName('head')[0];
          if (oldStyleNode === null || keepOldStyleNode === false) {
            var nextEl = sheet && sheet.nextSibling || null;
            if (nextEl) {
              nextEl.parentNode.insertBefore(styleNode, nextEl);
            } else {
              head.appendChild(styleNode);
            }
          }
          if (oldStyleNode && keepOldStyleNode === false) {
            oldStyleNode.parentNode.removeChild(oldStyleNode);
          }
          if (styleNode.styleSheet) {
            try {
              styleNode.styleSheet.cssText = styles;
            } catch (e) {
              throw new Error("Couldn't reassign styleSheet.cssText.");
            }
          }
        },
        currentScript: function(window) {
          var document = window.document;
          return document.currentScript || (function() {
            var scripts = document.getElementsByTagName("script");
            return scripts[scripts.length - 1];
          })();
        }
      };
    }, {"./utils": 9}],
    4: [function(require, module, exports) {
      module.exports = function(window, options, logger) {
        var cache = null;
        if (options.env !== 'development') {
          try {
            cache = (typeof window.localStorage === 'undefined') ? null : window.localStorage;
          } catch (_) {}
        }
        return {
          setCSS: function(path, lastModified, styles) {
            if (cache) {
              logger.info('saving ' + path + ' to cache.');
              try {
                cache.setItem(path, styles);
                cache.setItem(path + ':timestamp', lastModified);
              } catch (e) {
                logger.error('failed to save "' + path + '" to local storage for caching.');
              }
            }
          },
          getCSS: function(path, webInfo) {
            var css = cache && cache.getItem(path),
                timestamp = cache && cache.getItem(path + ':timestamp');
            if (timestamp && webInfo.lastModified && (new Date(webInfo.lastModified).valueOf() === new Date(timestamp).valueOf())) {
              return css;
            }
          }
        };
      };
    }, {}],
    5: [function(require, module, exports) {
      var utils = require("./utils"),
          browser = require("./browser");
      module.exports = function(window, less, options) {
        function errorHTML(e, rootHref) {
          var id = 'less-error-message:' + utils.extractId(rootHref || "");
          var template = '<li><label>{line}</label><pre class="{class}">{content}</pre></li>';
          var elem = window.document.createElement('div'),
              timer,
              content,
              errors = [];
          var filename = e.filename || rootHref;
          var filenameNoPath = filename.match(/([^\/]+(\?.*)?)$/)[1];
          elem.id = id;
          elem.className = "less-error-message";
          content = '<h3>' + (e.type || "Syntax") + "Error: " + (e.message || 'There is an error in your .less file') + '</h3>' + '<p>in <a href="' + filename + '">' + filenameNoPath + "</a> ";
          var errorline = function(e, i, classname) {
            if (e.extract[i] !== undefined) {
              errors.push(template.replace(/\{line\}/, (parseInt(e.line, 10) || 0) + (i - 1)).replace(/\{class\}/, classname).replace(/\{content\}/, e.extract[i]));
            }
          };
          if (e.extract) {
            errorline(e, 0, '');
            errorline(e, 1, 'line');
            errorline(e, 2, '');
            content += 'on line ' + e.line + ', column ' + (e.column + 1) + ':</p>' + '<ul>' + errors.join('') + '</ul>';
          }
          if (e.stack && (e.extract || options.logLevel >= 4)) {
            content += '<br/>Stack Trace</br />' + e.stack.split('\n').slice(1).join('<br/>');
          }
          elem.innerHTML = content;
          browser.createCSS(window.document, ['.less-error-message ul, .less-error-message li {', 'list-style-type: none;', 'margin-right: 15px;', 'padding: 4px 0;', 'margin: 0;', '}', '.less-error-message label {', 'font-size: 12px;', 'margin-right: 15px;', 'padding: 4px 0;', 'color: #cc7777;', '}', '.less-error-message pre {', 'color: #dd6666;', 'padding: 4px 0;', 'margin: 0;', 'display: inline-block;', '}', '.less-error-message pre.line {', 'color: #ff0000;', '}', '.less-error-message h3 {', 'font-size: 20px;', 'font-weight: bold;', 'padding: 15px 0 5px 0;', 'margin: 0;', '}', '.less-error-message a {', 'color: #10a', '}', '.less-error-message .error {', 'color: red;', 'font-weight: bold;', 'padding-bottom: 2px;', 'border-bottom: 1px dashed red;', '}'].join('\n'), {title: 'error-message'});
          elem.style.cssText = ["font-family: Arial, sans-serif", "border: 1px solid #e00", "background-color: #eee", "border-radius: 5px", "-webkit-border-radius: 5px", "-moz-border-radius: 5px", "color: #e00", "padding: 15px", "margin-bottom: 15px"].join(';');
          if (options.env === 'development') {
            timer = setInterval(function() {
              var document = window.document,
                  body = document.body;
              if (body) {
                if (document.getElementById(id)) {
                  body.replaceChild(elem, document.getElementById(id));
                } else {
                  body.insertBefore(elem, body.firstChild);
                }
                clearInterval(timer);
              }
            }, 10);
          }
        }
        function error(e, rootHref) {
          if (!options.errorReporting || options.errorReporting === "html") {
            errorHTML(e, rootHref);
          } else if (options.errorReporting === "console") {
            errorConsole(e, rootHref);
          } else if (typeof options.errorReporting === 'function') {
            options.errorReporting("add", e, rootHref);
          }
        }
        function removeErrorHTML(path) {
          var node = window.document.getElementById('less-error-message:' + utils.extractId(path));
          if (node) {
            node.parentNode.removeChild(node);
          }
        }
        function removeErrorConsole(path) {}
        function removeError(path) {
          if (!options.errorReporting || options.errorReporting === "html") {
            removeErrorHTML(path);
          } else if (options.errorReporting === "console") {
            removeErrorConsole(path);
          } else if (typeof options.errorReporting === 'function') {
            options.errorReporting("remove", path);
          }
        }
        function errorConsole(e, rootHref) {
          var template = '{line} {content}';
          var filename = e.filename || rootHref;
          var errors = [];
          var content = (e.type || "Syntax") + "Error: " + (e.message || 'There is an error in your .less file') + " in " + filename + " ";
          var errorline = function(e, i, classname) {
            if (e.extract[i] !== undefined) {
              errors.push(template.replace(/\{line\}/, (parseInt(e.line, 10) || 0) + (i - 1)).replace(/\{class\}/, classname).replace(/\{content\}/, e.extract[i]));
            }
          };
          if (e.extract) {
            errorline(e, 0, '');
            errorline(e, 1, 'line');
            errorline(e, 2, '');
            content += 'on line ' + e.line + ', column ' + (e.column + 1) + ':\n' + errors.join('\n');
          }
          if (e.stack && (e.extract || options.logLevel >= 4)) {
            content += '\nStack Trace\n' + e.stack;
          }
          less.logger.error(content);
        }
        return {
          add: error,
          remove: removeError
        };
      };
    }, {
      "./browser": 3,
      "./utils": 9
    }],
    6: [function(require, module, exports) {
      module.exports = function(options, logger) {
        var AbstractFileManager = require("../less/environment/abstract-file-manager.js");
        var fileCache = {};
        function getXMLHttpRequest() {
          if (window.XMLHttpRequest && (window.location.protocol !== "file:" || !("ActiveXObject" in window))) {
            return new XMLHttpRequest();
          } else {
            try {
              return new ActiveXObject("Microsoft.XMLHTTP");
            } catch (e) {
              logger.error("browser doesn't support AJAX.");
              return null;
            }
          }
        }
        var FileManager = function() {};
        FileManager.prototype = new AbstractFileManager();
        FileManager.prototype.alwaysMakePathsAbsolute = function alwaysMakePathsAbsolute() {
          return true;
        };
        FileManager.prototype.join = function join(basePath, laterPath) {
          if (!basePath) {
            return laterPath;
          }
          return this.extractUrlParts(laterPath, basePath).path;
        };
        FileManager.prototype.doXHR = function doXHR(url, type, callback, errback) {
          var xhr = getXMLHttpRequest();
          var async = options.isFileProtocol ? options.fileAsync : options.async;
          if (typeof xhr.overrideMimeType === 'function') {
            xhr.overrideMimeType('text/css');
          }
          logger.debug("XHR: Getting '" + url + "'");
          xhr.open('GET', url, async);
          xhr.setRequestHeader('Accept', type || 'text/x-less, text/css; q=0.9, */*; q=0.5');
          xhr.send(null);
          function handleResponse(xhr, callback, errback) {
            if (xhr.status >= 200 && xhr.status < 300) {
              callback(xhr.responseText, xhr.getResponseHeader("Last-Modified"));
            } else if (typeof errback === 'function') {
              errback(xhr.status, url);
            }
          }
          if (options.isFileProtocol && !options.fileAsync) {
            if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
              callback(xhr.responseText);
            } else {
              errback(xhr.status, url);
            }
          } else if (async) {
            xhr.onreadystatechange = function() {
              if (xhr.readyState == 4) {
                handleResponse(xhr, callback, errback);
              }
            };
          } else {
            handleResponse(xhr, callback, errback);
          }
        };
        FileManager.prototype.supports = function(filename, currentDirectory, options, environment) {
          return true;
        };
        FileManager.prototype.clearFileCache = function() {
          fileCache = {};
        };
        FileManager.prototype.loadFile = function loadFile(filename, currentDirectory, options, environment, callback) {
          if (currentDirectory && !this.isPathAbsolute(filename)) {
            filename = currentDirectory + filename;
          }
          options = options || {};
          var hrefParts = this.extractUrlParts(filename, window.location.href);
          var href = hrefParts.url;
          if (options.useFileCache && fileCache[href]) {
            try {
              var lessText = fileCache[href];
              callback(null, {
                contents: lessText,
                filename: href,
                webInfo: {lastModified: new Date()}
              });
            } catch (e) {
              callback({
                filename: href,
                message: "Error loading file " + href + " error was " + e.message
              });
            }
            return ;
          }
          this.doXHR(href, options.mime, function doXHRCallback(data, lastModified) {
            fileCache[href] = data;
            callback(null, {
              contents: data,
              filename: href,
              webInfo: {lastModified: lastModified}
            });
          }, function doXHRError(status, url) {
            callback({
              type: 'File',
              message: "'" + url + "' wasn't found (" + status + ")",
              href: href
            });
          });
        };
        return FileManager;
      };
    }, {"../less/environment/abstract-file-manager.js": 14}],
    7: [function(require, module, exports) {
      var addDataAttr = require("./utils").addDataAttr,
          browser = require("./browser");
      module.exports = function(window, options) {
        var document = window.document;
        var less = require('../less')();
        less.options = options;
        var environment = less.environment,
            FileManager = require("./file-manager")(options, less.logger),
            fileManager = new FileManager();
        environment.addFileManager(fileManager);
        less.FileManager = FileManager;
        require("./log-listener")(less, options);
        var errors = require("./error-reporting")(window, less, options);
        var cache = less.cache = options.cache || require("./cache")(window, options, less.logger);
        if (options.functions) {
          less.functions.functionRegistry.addMultiple(options.functions);
        }
        var typePattern = /^text\/(x-)?less$/;
        function postProcessCSS(styles) {
          if (options.postProcessor && typeof options.postProcessor === 'function') {
            styles = options.postProcessor.call(styles, styles) || styles;
          }
          return styles;
        }
        function clone(obj) {
          var cloned = {};
          for (var prop in obj) {
            if (obj.hasOwnProperty(prop)) {
              cloned[prop] = obj[prop];
            }
          }
          return cloned;
        }
        function bind(func, thisArg) {
          var curryArgs = Array.prototype.slice.call(arguments, 2);
          return function() {
            var args = curryArgs.concat(Array.prototype.slice.call(arguments, 0));
            return func.apply(thisArg, args);
          };
        }
        function loadStyles(modifyVars) {
          var styles = document.getElementsByTagName('style'),
              style;
          for (var i = 0; i < styles.length; i++) {
            style = styles[i];
            if (style.type.match(typePattern)) {
              var instanceOptions = clone(options);
              instanceOptions.modifyVars = modifyVars;
              var lessText = style.innerHTML || '';
              instanceOptions.filename = document.location.href.replace(/#.*$/, '');
              less.render(lessText, instanceOptions, bind(function(style, e, result) {
                if (e) {
                  errors.add(e, "inline");
                } else {
                  style.type = 'text/css';
                  if (style.styleSheet) {
                    style.styleSheet.cssText = result.css;
                  } else {
                    style.innerHTML = result.css;
                  }
                }
              }, null, style));
            }
          }
        }
        function loadStyleSheet(sheet, callback, reload, remaining, modifyVars) {
          var instanceOptions = clone(options);
          addDataAttr(instanceOptions, sheet);
          instanceOptions.mime = sheet.type;
          if (modifyVars) {
            instanceOptions.modifyVars = modifyVars;
          }
          function loadInitialFileCallback(loadedFile) {
            var data = loadedFile.contents,
                path = loadedFile.filename,
                webInfo = loadedFile.webInfo;
            var newFileInfo = {
              currentDirectory: fileManager.getPath(path),
              filename: path,
              rootFilename: path,
              relativeUrls: instanceOptions.relativeUrls
            };
            newFileInfo.entryPath = newFileInfo.currentDirectory;
            newFileInfo.rootpath = instanceOptions.rootpath || newFileInfo.currentDirectory;
            if (webInfo) {
              webInfo.remaining = remaining;
              if (!instanceOptions.modifyVars) {
                var css = cache.getCSS(path, webInfo);
                if (!reload && css) {
                  webInfo.local = true;
                  callback(null, css, data, sheet, webInfo, path);
                  return ;
                }
              }
            }
            errors.remove(path);
            instanceOptions.rootFileInfo = newFileInfo;
            less.render(data, instanceOptions, function(e, result) {
              if (e) {
                e.href = path;
                callback(e);
              } else {
                result.css = postProcessCSS(result.css);
                if (!instanceOptions.modifyVars) {
                  cache.setCSS(sheet.href, webInfo.lastModified, result.css);
                }
                callback(null, result.css, data, sheet, webInfo, path);
              }
            });
          }
          fileManager.loadFile(sheet.href, null, instanceOptions, environment, function(e, loadedFile) {
            if (e) {
              callback(e);
              return ;
            }
            loadInitialFileCallback(loadedFile);
          });
        }
        function loadStyleSheets(callback, reload, modifyVars) {
          for (var i = 0; i < less.sheets.length; i++) {
            loadStyleSheet(less.sheets[i], callback, reload, less.sheets.length - (i + 1), modifyVars);
          }
        }
        function initRunningMode() {
          if (less.env === 'development') {
            less.watchTimer = setInterval(function() {
              if (less.watchMode) {
                fileManager.clearFileCache();
                loadStyleSheets(function(e, css, _, sheet, webInfo) {
                  if (e) {
                    errors.add(e, e.href || sheet.href);
                  } else if (css) {
                    browser.createCSS(window.document, css, sheet);
                  }
                });
              }
            }, options.poll);
          }
        }
        less.watch = function() {
          if (!less.watchMode) {
            less.env = 'development';
            initRunningMode();
          }
          this.watchMode = true;
          return true;
        };
        less.unwatch = function() {
          clearInterval(less.watchTimer);
          this.watchMode = false;
          return false;
        };
        less.registerStylesheets = function() {
          return new Promise(function(resolve, reject) {
            var links = document.getElementsByTagName('link');
            less.sheets = [];
            for (var i = 0; i < links.length; i++) {
              if (links[i].rel === 'stylesheet/less' || (links[i].rel.match(/stylesheet/) && (links[i].type.match(typePattern)))) {
                less.sheets.push(links[i]);
              }
            }
            resolve();
          });
        };
        less.modifyVars = function(record) {
          return less.refresh(true, record, false);
        };
        less.refresh = function(reload, modifyVars, clearFileCache) {
          if ((reload || clearFileCache) && clearFileCache !== false) {
            fileManager.clearFileCache();
          }
          return new Promise(function(resolve, reject) {
            var startTime,
                endTime,
                totalMilliseconds;
            startTime = endTime = new Date();
            loadStyleSheets(function(e, css, _, sheet, webInfo) {
              if (e) {
                errors.add(e, e.href || sheet.href);
                reject(e);
                return ;
              }
              if (webInfo.local) {
                less.logger.info("loading " + sheet.href + " from cache.");
              } else {
                less.logger.info("rendered " + sheet.href + " successfully.");
              }
              browser.createCSS(window.document, css, sheet);
              less.logger.info("css for " + sheet.href + " generated in " + (new Date() - endTime) + 'ms');
              if (webInfo.remaining === 0) {
                totalMilliseconds = new Date() - startTime;
                less.logger.info("less has finished. css generated in " + totalMilliseconds + 'ms');
                resolve({
                  startTime: startTime,
                  endTime: endTime,
                  totalMilliseconds: totalMilliseconds,
                  sheets: less.sheets.length
                });
              }
              endTime = new Date();
            }, reload, modifyVars);
            loadStyles(modifyVars);
          });
        };
        less.refreshStyles = loadStyles;
        return less;
      };
    }, {
      "../less": 29,
      "./browser": 3,
      "./cache": 4,
      "./error-reporting": 5,
      "./file-manager": 6,
      "./log-listener": 8,
      "./utils": 9
    }],
    8: [function(require, module, exports) {
      module.exports = function(less, options) {
        var logLevel_debug = 4,
            logLevel_info = 3,
            logLevel_warn = 2,
            logLevel_error = 1;
        options.logLevel = typeof options.logLevel !== 'undefined' ? options.logLevel : (options.env === 'development' ? logLevel_info : logLevel_error);
        if (!options.loggers) {
          options.loggers = [{
            debug: function(msg) {
              if (options.logLevel >= logLevel_debug) {
                console.log(msg);
              }
            },
            info: function(msg) {
              if (options.logLevel >= logLevel_info) {
                console.log(msg);
              }
            },
            warn: function(msg) {
              if (options.logLevel >= logLevel_warn) {
                console.warn(msg);
              }
            },
            error: function(msg) {
              if (options.logLevel >= logLevel_error) {
                console.error(msg);
              }
            }
          }];
        }
        for (var i = 0; i < options.loggers.length; i++) {
          less.logger.addListener(options.loggers[i]);
        }
      };
    }, {}],
    9: [function(require, module, exports) {
      module.exports = {
        extractId: function(href) {
          return href.replace(/^[a-z-]+:\/+?[^\/]+/, '').replace(/[\?\&]livereload=\w+/, '').replace(/^\//, '').replace(/\.[a-zA-Z]+$/, '').replace(/[^\.\w-]+/g, '-').replace(/\./g, ':');
        },
        addDataAttr: function(options, tag) {
          for (var opt in tag.dataset) {
            if (tag.dataset.hasOwnProperty(opt)) {
              if (opt === "env" || opt === "dumpLineNumbers" || opt === "rootpath" || opt === "errorReporting") {
                options[opt] = tag.dataset[opt];
              } else {
                try {
                  options[opt] = JSON.parse(tag.dataset[opt]);
                } catch (_) {}
              }
            }
          }
        }
      };
    }, {}],
    10: [function(require, module, exports) {
      var contexts = {};
      module.exports = contexts;
      var copyFromOriginal = function copyFromOriginal(original, destination, propertiesToCopy) {
        if (!original) {
          return ;
        }
        for (var i = 0; i < propertiesToCopy.length; i++) {
          if (original.hasOwnProperty(propertiesToCopy[i])) {
            destination[propertiesToCopy[i]] = original[propertiesToCopy[i]];
          }
        }
      };
      var parseCopyProperties = ['paths', 'relativeUrls', 'rootpath', 'strictImports', 'insecure', 'dumpLineNumbers', 'compress', 'syncImport', 'chunkInput', 'mime', 'useFileCache', 'processImports', 'reference', 'pluginManager'];
      contexts.Parse = function(options) {
        copyFromOriginal(options, this, parseCopyProperties);
        if (typeof this.paths === "string") {
          this.paths = [this.paths];
        }
      };
      var evalCopyProperties = ['paths', 'compress', 'ieCompat', 'strictMath', 'strictUnits', 'sourceMap', 'importMultiple', 'urlArgs', 'javascriptEnabled', 'pluginManager', 'importantScope'];
      contexts.Eval = function(options, frames) {
        copyFromOriginal(options, this, evalCopyProperties);
        this.frames = frames || [];
        this.importantScope = this.importantScope || [];
      };
      contexts.Eval.prototype.inParenthesis = function() {
        if (!this.parensStack) {
          this.parensStack = [];
        }
        this.parensStack.push(true);
      };
      contexts.Eval.prototype.outOfParenthesis = function() {
        this.parensStack.pop();
      };
      contexts.Eval.prototype.isMathOn = function() {
        return this.strictMath ? (this.parensStack && this.parensStack.length) : true;
      };
      contexts.Eval.prototype.isPathRelative = function(path) {
        return !/^(?:[a-z-]+:|\/|#)/i.test(path);
      };
      contexts.Eval.prototype.normalizePath = function(path) {
        var segments = path.split("/").reverse(),
            segment;
        path = [];
        while (segments.length !== 0) {
          segment = segments.pop();
          switch (segment) {
            case ".":
              break;
            case "..":
              if ((path.length === 0) || (path[path.length - 1] === "..")) {
                path.push(segment);
              } else {
                path.pop();
              }
              break;
            default:
              path.push(segment);
              break;
          }
        }
        return path.join("/");
      };
    }, {}],
    11: [function(require, module, exports) {
      module.exports = {
        'aliceblue': '#f0f8ff',
        'antiquewhite': '#faebd7',
        'aqua': '#00ffff',
        'aquamarine': '#7fffd4',
        'azure': '#f0ffff',
        'beige': '#f5f5dc',
        'bisque': '#ffe4c4',
        'black': '#000000',
        'blanchedalmond': '#ffebcd',
        'blue': '#0000ff',
        'blueviolet': '#8a2be2',
        'brown': '#a52a2a',
        'burlywood': '#deb887',
        'cadetblue': '#5f9ea0',
        'chartreuse': '#7fff00',
        'chocolate': '#d2691e',
        'coral': '#ff7f50',
        'cornflowerblue': '#6495ed',
        'cornsilk': '#fff8dc',
        'crimson': '#dc143c',
        'cyan': '#00ffff',
        'darkblue': '#00008b',
        'darkcyan': '#008b8b',
        'darkgoldenrod': '#b8860b',
        'darkgray': '#a9a9a9',
        'darkgrey': '#a9a9a9',
        'darkgreen': '#006400',
        'darkkhaki': '#bdb76b',
        'darkmagenta': '#8b008b',
        'darkolivegreen': '#556b2f',
        'darkorange': '#ff8c00',
        'darkorchid': '#9932cc',
        'darkred': '#8b0000',
        'darksalmon': '#e9967a',
        'darkseagreen': '#8fbc8f',
        'darkslateblue': '#483d8b',
        'darkslategray': '#2f4f4f',
        'darkslategrey': '#2f4f4f',
        'darkturquoise': '#00ced1',
        'darkviolet': '#9400d3',
        'deeppink': '#ff1493',
        'deepskyblue': '#00bfff',
        'dimgray': '#696969',
        'dimgrey': '#696969',
        'dodgerblue': '#1e90ff',
        'firebrick': '#b22222',
        'floralwhite': '#fffaf0',
        'forestgreen': '#228b22',
        'fuchsia': '#ff00ff',
        'gainsboro': '#dcdcdc',
        'ghostwhite': '#f8f8ff',
        'gold': '#ffd700',
        'goldenrod': '#daa520',
        'gray': '#808080',
        'grey': '#808080',
        'green': '#008000',
        'greenyellow': '#adff2f',
        'honeydew': '#f0fff0',
        'hotpink': '#ff69b4',
        'indianred': '#cd5c5c',
        'indigo': '#4b0082',
        'ivory': '#fffff0',
        'khaki': '#f0e68c',
        'lavender': '#e6e6fa',
        'lavenderblush': '#fff0f5',
        'lawngreen': '#7cfc00',
        'lemonchiffon': '#fffacd',
        'lightblue': '#add8e6',
        'lightcoral': '#f08080',
        'lightcyan': '#e0ffff',
        'lightgoldenrodyellow': '#fafad2',
        'lightgray': '#d3d3d3',
        'lightgrey': '#d3d3d3',
        'lightgreen': '#90ee90',
        'lightpink': '#ffb6c1',
        'lightsalmon': '#ffa07a',
        'lightseagreen': '#20b2aa',
        'lightskyblue': '#87cefa',
        'lightslategray': '#778899',
        'lightslategrey': '#778899',
        'lightsteelblue': '#b0c4de',
        'lightyellow': '#ffffe0',
        'lime': '#00ff00',
        'limegreen': '#32cd32',
        'linen': '#faf0e6',
        'magenta': '#ff00ff',
        'maroon': '#800000',
        'mediumaquamarine': '#66cdaa',
        'mediumblue': '#0000cd',
        'mediumorchid': '#ba55d3',
        'mediumpurple': '#9370d8',
        'mediumseagreen': '#3cb371',
        'mediumslateblue': '#7b68ee',
        'mediumspringgreen': '#00fa9a',
        'mediumturquoise': '#48d1cc',
        'mediumvioletred': '#c71585',
        'midnightblue': '#191970',
        'mintcream': '#f5fffa',
        'mistyrose': '#ffe4e1',
        'moccasin': '#ffe4b5',
        'navajowhite': '#ffdead',
        'navy': '#000080',
        'oldlace': '#fdf5e6',
        'olive': '#808000',
        'olivedrab': '#6b8e23',
        'orange': '#ffa500',
        'orangered': '#ff4500',
        'orchid': '#da70d6',
        'palegoldenrod': '#eee8aa',
        'palegreen': '#98fb98',
        'paleturquoise': '#afeeee',
        'palevioletred': '#d87093',
        'papayawhip': '#ffefd5',
        'peachpuff': '#ffdab9',
        'peru': '#cd853f',
        'pink': '#ffc0cb',
        'plum': '#dda0dd',
        'powderblue': '#b0e0e6',
        'purple': '#800080',
        'rebeccapurple': '#663399',
        'red': '#ff0000',
        'rosybrown': '#bc8f8f',
        'royalblue': '#4169e1',
        'saddlebrown': '#8b4513',
        'salmon': '#fa8072',
        'sandybrown': '#f4a460',
        'seagreen': '#2e8b57',
        'seashell': '#fff5ee',
        'sienna': '#a0522d',
        'silver': '#c0c0c0',
        'skyblue': '#87ceeb',
        'slateblue': '#6a5acd',
        'slategray': '#708090',
        'slategrey': '#708090',
        'snow': '#fffafa',
        'springgreen': '#00ff7f',
        'steelblue': '#4682b4',
        'tan': '#d2b48c',
        'teal': '#008080',
        'thistle': '#d8bfd8',
        'tomato': '#ff6347',
        'turquoise': '#40e0d0',
        'violet': '#ee82ee',
        'wheat': '#f5deb3',
        'white': '#ffffff',
        'whitesmoke': '#f5f5f5',
        'yellow': '#ffff00',
        'yellowgreen': '#9acd32'
      };
    }, {}],
    12: [function(require, module, exports) {
      module.exports = {
        colors: require("./colors"),
        unitConversions: require("./unit-conversions")
      };
    }, {
      "./colors": 11,
      "./unit-conversions": 13
    }],
    13: [function(require, module, exports) {
      module.exports = {
        length: {
          'm': 1,
          'cm': 0.01,
          'mm': 0.001,
          'in': 0.0254,
          'px': 0.0254 / 96,
          'pt': 0.0254 / 72,
          'pc': 0.0254 / 72 * 12
        },
        duration: {
          's': 1,
          'ms': 0.001
        },
        angle: {
          'rad': 1 / (2 * Math.PI),
          'deg': 1 / 360,
          'grad': 1 / 400,
          'turn': 1
        }
      };
    }, {}],
    14: [function(require, module, exports) {
      var abstractFileManager = function() {};
      abstractFileManager.prototype.getPath = function(filename) {
        var j = filename.lastIndexOf('?');
        if (j > 0) {
          filename = filename.slice(0, j);
        }
        j = filename.lastIndexOf('/');
        if (j < 0) {
          j = filename.lastIndexOf('\\');
        }
        if (j < 0) {
          return "";
        }
        return filename.slice(0, j + 1);
      };
      abstractFileManager.prototype.tryAppendLessExtension = function(path) {
        return /(\.[a-z]*$)|([\?;].*)$/.test(path) ? path : path + '.less';
      };
      abstractFileManager.prototype.supportsSync = function() {
        return false;
      };
      abstractFileManager.prototype.alwaysMakePathsAbsolute = function() {
        return false;
      };
      abstractFileManager.prototype.isPathAbsolute = function(filename) {
        return (/^(?:[a-z-]+:|\/|\\|#)/i).test(filename);
      };
      abstractFileManager.prototype.join = function(basePath, laterPath) {
        if (!basePath) {
          return laterPath;
        }
        return basePath + laterPath;
      };
      abstractFileManager.prototype.pathDiff = function pathDiff(url, baseUrl) {
        var urlParts = this.extractUrlParts(url),
            baseUrlParts = this.extractUrlParts(baseUrl),
            i,
            max,
            urlDirectories,
            baseUrlDirectories,
            diff = "";
        if (urlParts.hostPart !== baseUrlParts.hostPart) {
          return "";
        }
        max = Math.max(baseUrlParts.directories.length, urlParts.directories.length);
        for (i = 0; i < max; i++) {
          if (baseUrlParts.directories[i] !== urlParts.directories[i]) {
            break;
          }
        }
        baseUrlDirectories = baseUrlParts.directories.slice(i);
        urlDirectories = urlParts.directories.slice(i);
        for (i = 0; i < baseUrlDirectories.length - 1; i++) {
          diff += "../";
        }
        for (i = 0; i < urlDirectories.length - 1; i++) {
          diff += urlDirectories[i] + "/";
        }
        return diff;
      };
      abstractFileManager.prototype.extractUrlParts = function extractUrlParts(url, baseUrl) {
        var urlPartsRegex = /^((?:[a-z-]+:)?\/+?(?:[^\/\?#]*\/)|([\/\\]))?((?:[^\/\\\?#]*[\/\\])*)([^\/\\\?#]*)([#\?].*)?$/i,
            urlParts = url.match(urlPartsRegex),
            returner = {},
            directories = [],
            i,
            baseUrlParts;
        if (!urlParts) {
          throw new Error("Could not parse sheet href - '" + url + "'");
        }
        if (baseUrl && (!urlParts[1] || urlParts[2])) {
          baseUrlParts = baseUrl.match(urlPartsRegex);
          if (!baseUrlParts) {
            throw new Error("Could not parse page url - '" + baseUrl + "'");
          }
          urlParts[1] = urlParts[1] || baseUrlParts[1] || "";
          if (!urlParts[2]) {
            urlParts[3] = baseUrlParts[3] + urlParts[3];
          }
        }
        if (urlParts[3]) {
          directories = urlParts[3].replace(/\\/g, "/").split("/");
          for (i = 0; i < directories.length; i++) {
            if (directories[i] === ".") {
              directories.splice(i, 1);
              i -= 1;
            }
          }
          for (i = 0; i < directories.length; i++) {
            if (directories[i] === ".." && i > 0) {
              directories.splice(i - 1, 2);
              i -= 2;
            }
          }
        }
        returner.hostPart = urlParts[1];
        returner.directories = directories;
        returner.path = (urlParts[1] || "") + directories.join("/");
        returner.fileUrl = returner.path + (urlParts[4] || "");
        returner.url = returner.fileUrl + (urlParts[5] || "");
        return returner;
      };
      module.exports = abstractFileManager;
    }, {}],
    15: [function(require, module, exports) {
      var logger = require("../logger");
      var environment = function(externalEnvironment, fileManagers) {
        this.fileManagers = fileManagers || [];
        externalEnvironment = externalEnvironment || {};
        var optionalFunctions = ["encodeBase64", "mimeLookup", "charsetLookup", "getSourceMapGenerator"],
            requiredFunctions = [],
            functions = requiredFunctions.concat(optionalFunctions);
        for (var i = 0; i < functions.length; i++) {
          var propName = functions[i],
              environmentFunc = externalEnvironment[propName];
          if (environmentFunc) {
            this[propName] = environmentFunc.bind(externalEnvironment);
          } else if (i < requiredFunctions.length) {
            this.warn("missing required function in environment - " + propName);
          }
        }
      };
      environment.prototype.getFileManager = function(filename, currentDirectory, options, environment, isSync) {
        if (!filename) {
          logger.warn("getFileManager called with no filename.. Please report this issue. continuing.");
        }
        if (currentDirectory == null) {
          logger.warn("getFileManager called with null directory.. Please report this issue. continuing.");
        }
        var fileManagers = this.fileManagers;
        if (options.pluginManager) {
          fileManagers = [].concat(fileManagers).concat(options.pluginManager.getFileManagers());
        }
        for (var i = fileManagers.length - 1; i >= 0; i--) {
          var fileManager = fileManagers[i];
          if (fileManager[isSync ? "supportsSync" : "supports"](filename, currentDirectory, options, environment)) {
            return fileManager;
          }
        }
        return null;
      };
      environment.prototype.addFileManager = function(fileManager) {
        this.fileManagers.push(fileManager);
      };
      environment.prototype.clearFileManagers = function() {
        this.fileManagers = [];
      };
      module.exports = environment;
    }, {"../logger": 31}],
    16: [function(require, module, exports) {
      var Color = require("../tree/color"),
          functionRegistry = require("./function-registry");
      function colorBlend(mode, color1, color2) {
        var ab = color1.alpha,
            cb,
            as = color2.alpha,
            cs,
            ar,
            cr,
            r = [];
        ar = as + ab * (1 - as);
        for (var i = 0; i < 3; i++) {
          cb = color1.rgb[i] / 255;
          cs = color2.rgb[i] / 255;
          cr = mode(cb, cs);
          if (ar) {
            cr = (as * cs + ab * (cb - as * (cb + cs - cr))) / ar;
          }
          r[i] = cr * 255;
        }
        return new Color(r, ar);
      }
      var colorBlendModeFunctions = {
        multiply: function(cb, cs) {
          return cb * cs;
        },
        screen: function(cb, cs) {
          return cb + cs - cb * cs;
        },
        overlay: function(cb, cs) {
          cb *= 2;
          return (cb <= 1) ? colorBlendModeFunctions.multiply(cb, cs) : colorBlendModeFunctions.screen(cb - 1, cs);
        },
        softlight: function(cb, cs) {
          var d = 1,
              e = cb;
          if (cs > 0.5) {
            e = 1;
            d = (cb > 0.25) ? Math.sqrt(cb) : ((16 * cb - 12) * cb + 4) * cb;
          }
          return cb - (1 - 2 * cs) * e * (d - cb);
        },
        hardlight: function(cb, cs) {
          return colorBlendModeFunctions.overlay(cs, cb);
        },
        difference: function(cb, cs) {
          return Math.abs(cb - cs);
        },
        exclusion: function(cb, cs) {
          return cb + cs - 2 * cb * cs;
        },
        average: function(cb, cs) {
          return (cb + cs) / 2;
        },
        negation: function(cb, cs) {
          return 1 - Math.abs(cb + cs - 1);
        }
      };
      for (var f in colorBlendModeFunctions) {
        if (colorBlendModeFunctions.hasOwnProperty(f)) {
          colorBlend[f] = colorBlend.bind(null, colorBlendModeFunctions[f]);
        }
      }
      functionRegistry.addMultiple(colorBlend);
    }, {
      "../tree/color": 47,
      "./function-registry": 21
    }],
    17: [function(require, module, exports) {
      var Dimension = require("../tree/dimension"),
          Color = require("../tree/color"),
          Quoted = require("../tree/quoted"),
          Anonymous = require("../tree/anonymous"),
          functionRegistry = require("./function-registry"),
          colorFunctions;
      function clamp(val) {
        return Math.min(1, Math.max(0, val));
      }
      function hsla(color) {
        return colorFunctions.hsla(color.h, color.s, color.l, color.a);
      }
      function number(n) {
        if (n instanceof Dimension) {
          return parseFloat(n.unit.is('%') ? n.value / 100 : n.value);
        } else if (typeof n === 'number') {
          return n;
        } else {
          throw {
            type: "Argument",
            message: "color functions take numbers as parameters"
          };
        }
      }
      function scaled(n, size) {
        if (n instanceof Dimension && n.unit.is('%')) {
          return parseFloat(n.value * size / 100);
        } else {
          return number(n);
        }
      }
      colorFunctions = {
        rgb: function(r, g, b) {
          return colorFunctions.rgba(r, g, b, 1.0);
        },
        rgba: function(r, g, b, a) {
          var rgb = [r, g, b].map(function(c) {
            return scaled(c, 255);
          });
          a = number(a);
          return new Color(rgb, a);
        },
        hsl: function(h, s, l) {
          return colorFunctions.hsla(h, s, l, 1.0);
        },
        hsla: function(h, s, l, a) {
          function hue(h) {
            h = h < 0 ? h + 1 : (h > 1 ? h - 1 : h);
            if (h * 6 < 1) {
              return m1 + (m2 - m1) * h * 6;
            } else if (h * 2 < 1) {
              return m2;
            } else if (h * 3 < 2) {
              return m1 + (m2 - m1) * (2 / 3 - h) * 6;
            } else {
              return m1;
            }
          }
          h = (number(h) % 360) / 360;
          s = clamp(number(s));
          l = clamp(number(l));
          a = clamp(number(a));
          var m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
          var m1 = l * 2 - m2;
          return colorFunctions.rgba(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255, a);
        },
        hsv: function(h, s, v) {
          return colorFunctions.hsva(h, s, v, 1.0);
        },
        hsva: function(h, s, v, a) {
          h = ((number(h) % 360) / 360) * 360;
          s = number(s);
          v = number(v);
          a = number(a);
          var i,
              f;
          i = Math.floor((h / 60) % 6);
          f = (h / 60) - i;
          var vs = [v, v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
          var perm = [[0, 3, 1], [2, 0, 1], [1, 0, 3], [1, 2, 0], [3, 1, 0], [0, 1, 2]];
          return colorFunctions.rgba(vs[perm[i][0]] * 255, vs[perm[i][1]] * 255, vs[perm[i][2]] * 255, a);
        },
        hue: function(color) {
          return new Dimension(color.toHSL().h);
        },
        saturation: function(color) {
          return new Dimension(color.toHSL().s * 100, '%');
        },
        lightness: function(color) {
          return new Dimension(color.toHSL().l * 100, '%');
        },
        hsvhue: function(color) {
          return new Dimension(color.toHSV().h);
        },
        hsvsaturation: function(color) {
          return new Dimension(color.toHSV().s * 100, '%');
        },
        hsvvalue: function(color) {
          return new Dimension(color.toHSV().v * 100, '%');
        },
        red: function(color) {
          return new Dimension(color.rgb[0]);
        },
        green: function(color) {
          return new Dimension(color.rgb[1]);
        },
        blue: function(color) {
          return new Dimension(color.rgb[2]);
        },
        alpha: function(color) {
          return new Dimension(color.toHSL().a);
        },
        luma: function(color) {
          return new Dimension(color.luma() * color.alpha * 100, '%');
        },
        luminance: function(color) {
          var luminance = (0.2126 * color.rgb[0] / 255) + (0.7152 * color.rgb[1] / 255) + (0.0722 * color.rgb[2] / 255);
          return new Dimension(luminance * color.alpha * 100, '%');
        },
        saturate: function(color, amount) {
          if (!color.rgb) {
            return null;
          }
          var hsl = color.toHSL();
          hsl.s += amount.value / 100;
          hsl.s = clamp(hsl.s);
          return hsla(hsl);
        },
        desaturate: function(color, amount) {
          var hsl = color.toHSL();
          hsl.s -= amount.value / 100;
          hsl.s = clamp(hsl.s);
          return hsla(hsl);
        },
        lighten: function(color, amount) {
          var hsl = color.toHSL();
          hsl.l += amount.value / 100;
          hsl.l = clamp(hsl.l);
          return hsla(hsl);
        },
        darken: function(color, amount) {
          var hsl = color.toHSL();
          hsl.l -= amount.value / 100;
          hsl.l = clamp(hsl.l);
          return hsla(hsl);
        },
        fadein: function(color, amount) {
          var hsl = color.toHSL();
          hsl.a += amount.value / 100;
          hsl.a = clamp(hsl.a);
          return hsla(hsl);
        },
        fadeout: function(color, amount) {
          var hsl = color.toHSL();
          hsl.a -= amount.value / 100;
          hsl.a = clamp(hsl.a);
          return hsla(hsl);
        },
        fade: function(color, amount) {
          var hsl = color.toHSL();
          hsl.a = amount.value / 100;
          hsl.a = clamp(hsl.a);
          return hsla(hsl);
        },
        spin: function(color, amount) {
          var hsl = color.toHSL();
          var hue = (hsl.h + amount.value) % 360;
          hsl.h = hue < 0 ? 360 + hue : hue;
          return hsla(hsl);
        },
        mix: function(color1, color2, weight) {
          if (!weight) {
            weight = new Dimension(50);
          }
          var p = weight.value / 100.0;
          var w = p * 2 - 1;
          var a = color1.toHSL().a - color2.toHSL().a;
          var w1 = (((w * a == -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0;
          var w2 = 1 - w1;
          var rgb = [color1.rgb[0] * w1 + color2.rgb[0] * w2, color1.rgb[1] * w1 + color2.rgb[1] * w2, color1.rgb[2] * w1 + color2.rgb[2] * w2];
          var alpha = color1.alpha * p + color2.alpha * (1 - p);
          return new Color(rgb, alpha);
        },
        greyscale: function(color) {
          return colorFunctions.desaturate(color, new Dimension(100));
        },
        contrast: function(color, dark, light, threshold) {
          if (!color.rgb) {
            return null;
          }
          if (typeof light === 'undefined') {
            light = colorFunctions.rgba(255, 255, 255, 1.0);
          }
          if (typeof dark === 'undefined') {
            dark = colorFunctions.rgba(0, 0, 0, 1.0);
          }
          if (dark.luma() > light.luma()) {
            var t = light;
            light = dark;
            dark = t;
          }
          if (typeof threshold === 'undefined') {
            threshold = 0.43;
          } else {
            threshold = number(threshold);
          }
          if (color.luma() < threshold) {
            return light;
          } else {
            return dark;
          }
        },
        argb: function(color) {
          return new Anonymous(color.toARGB());
        },
        color: function(c) {
          if ((c instanceof Quoted) && (/^#([a-f0-9]{6}|[a-f0-9]{3})$/i.test(c.value))) {
            return new Color(c.value.slice(1));
          }
          if ((c instanceof Color) || (c = Color.fromKeyword(c.value))) {
            c.value = undefined;
            return c;
          }
          throw {
            type: "Argument",
            message: "argument must be a color keyword or 3/6 digit hex e.g. #FFF"
          };
        },
        tint: function(color, amount) {
          return colorFunctions.mix(colorFunctions.rgb(255, 255, 255), color, amount);
        },
        shade: function(color, amount) {
          return colorFunctions.mix(colorFunctions.rgb(0, 0, 0), color, amount);
        }
      };
      functionRegistry.addMultiple(colorFunctions);
    }, {
      "../tree/anonymous": 43,
      "../tree/color": 47,
      "../tree/dimension": 53,
      "../tree/quoted": 70,
      "./function-registry": 21
    }],
    18: [function(require, module, exports) {
      module.exports = function(environment) {
        var Quoted = require("../tree/quoted"),
            URL = require("../tree/url"),
            functionRegistry = require("./function-registry"),
            fallback = function(functionThis, node) {
              return new URL(node, functionThis.index, functionThis.currentFileInfo).eval(functionThis.context);
            },
            logger = require('../logger');
        functionRegistry.add("data-uri", function(mimetypeNode, filePathNode) {
          if (!filePathNode) {
            filePathNode = mimetypeNode;
            mimetypeNode = null;
          }
          var mimetype = mimetypeNode && mimetypeNode.value;
          var filePath = filePathNode.value;
          var currentFileInfo = this.currentFileInfo;
          var currentDirectory = currentFileInfo.relativeUrls ? currentFileInfo.currentDirectory : currentFileInfo.entryPath;
          var fragmentStart = filePath.indexOf('#');
          var fragment = '';
          if (fragmentStart !== -1) {
            fragment = filePath.slice(fragmentStart);
            filePath = filePath.slice(0, fragmentStart);
          }
          var fileManager = environment.getFileManager(filePath, currentDirectory, this.context, environment, true);
          if (!fileManager) {
            return fallback(this, filePathNode);
          }
          var useBase64 = false;
          if (!mimetypeNode) {
            mimetype = environment.mimeLookup(filePath);
            if (mimetype === "image/svg+xml") {
              useBase64 = false;
            } else {
              var charset = environment.charsetLookup(mimetype);
              useBase64 = ['US-ASCII', 'UTF-8'].indexOf(charset) < 0;
            }
            if (useBase64) {
              mimetype += ';base64';
            }
          } else {
            useBase64 = /;base64$/.test(mimetype);
          }
          var fileSync = fileManager.loadFileSync(filePath, currentDirectory, this.context, environment);
          if (!fileSync.contents) {
            logger.warn("Skipped data-uri embedding of " + filePath + " because file not found");
            return fallback(this, filePathNode || mimetypeNode);
          }
          var buf = fileSync.contents;
          if (useBase64 && !environment.encodeBase64) {
            return fallback(this, filePathNode);
          }
          buf = useBase64 ? environment.encodeBase64(buf) : encodeURIComponent(buf);
          var uri = "data:" + mimetype + ',' + buf + fragment;
          var DATA_URI_MAX = 32768;
          if (uri.length >= DATA_URI_MAX) {
            if (this.context.ieCompat !== false) {
              logger.warn("Skipped data-uri embedding of " + filePath + " because its size (" + uri.length + " characters) exceeds IE8-safe " + DATA_URI_MAX + " characters!");
              return fallback(this, filePathNode || mimetypeNode);
            }
          }
          return new URL(new Quoted('"' + uri + '"', uri, false, this.index, this.currentFileInfo), this.index, this.currentFileInfo);
        });
      };
    }, {
      "../logger": 31,
      "../tree/quoted": 70,
      "../tree/url": 77,
      "./function-registry": 21
    }],
    19: [function(require, module, exports) {
      var Keyword = require("../tree/keyword"),
          functionRegistry = require("./function-registry");
      var defaultFunc = {
        eval: function() {
          var v = this.value_,
              e = this.error_;
          if (e) {
            throw e;
          }
          if (v != null) {
            return v ? Keyword.True : Keyword.False;
          }
        },
        value: function(v) {
          this.value_ = v;
        },
        error: function(e) {
          this.error_ = e;
        },
        reset: function() {
          this.value_ = this.error_ = null;
        }
      };
      functionRegistry.add("default", defaultFunc.eval.bind(defaultFunc));
      module.exports = defaultFunc;
    }, {
      "../tree/keyword": 62,
      "./function-registry": 21
    }],
    20: [function(require, module, exports) {
      var functionRegistry = require("./function-registry");
      var functionCaller = function(name, context, index, currentFileInfo) {
        this.name = name.toLowerCase();
        this.func = functionRegistry.get(this.name);
        this.index = index;
        this.context = context;
        this.currentFileInfo = currentFileInfo;
      };
      functionCaller.prototype.isValid = function() {
        return Boolean(this.func);
      };
      functionCaller.prototype.call = function(args) {
        return this.func.apply(this, args);
      };
      module.exports = functionCaller;
    }, {"./function-registry": 21}],
    21: [function(require, module, exports) {
      module.exports = {
        _data: {},
        add: function(name, func) {
          if (this._data.hasOwnProperty(name)) {}
          this._data[name] = func;
        },
        addMultiple: function(functions) {
          Object.keys(functions).forEach(function(name) {
            this.add(name, functions[name]);
          }.bind(this));
        },
        get: function(name) {
          return this._data[name];
        }
      };
    }, {}],
    22: [function(require, module, exports) {
      module.exports = function(environment) {
        var functions = {
          functionRegistry: require("./function-registry"),
          functionCaller: require("./function-caller")
        };
        require("./default");
        require("./color");
        require("./color-blending");
        require("./data-uri")(environment);
        require("./math");
        require("./number");
        require("./string");
        require("./svg")(environment);
        require("./types");
        return functions;
      };
    }, {
      "./color": 17,
      "./color-blending": 16,
      "./data-uri": 18,
      "./default": 19,
      "./function-caller": 20,
      "./function-registry": 21,
      "./math": 23,
      "./number": 24,
      "./string": 25,
      "./svg": 26,
      "./types": 27
    }],
    23: [function(require, module, exports) {
      var Dimension = require("../tree/dimension"),
          functionRegistry = require("./function-registry");
      var mathFunctions = {
        ceil: null,
        floor: null,
        sqrt: null,
        abs: null,
        tan: "",
        sin: "",
        cos: "",
        atan: "rad",
        asin: "rad",
        acos: "rad"
      };
      function _math(fn, unit, n) {
        if (!(n instanceof Dimension)) {
          throw {
            type: "Argument",
            message: "argument must be a number"
          };
        }
        if (unit == null) {
          unit = n.unit;
        } else {
          n = n.unify();
        }
        return new Dimension(fn(parseFloat(n.value)), unit);
      }
      for (var f in mathFunctions) {
        if (mathFunctions.hasOwnProperty(f)) {
          mathFunctions[f] = _math.bind(null, Math[f], mathFunctions[f]);
        }
      }
      mathFunctions.round = function(n, f) {
        var fraction = typeof f === "undefined" ? 0 : f.value;
        return _math(function(num) {
          return num.toFixed(fraction);
        }, null, n);
      };
      functionRegistry.addMultiple(mathFunctions);
    }, {
      "../tree/dimension": 53,
      "./function-registry": 21
    }],
    24: [function(require, module, exports) {
      var Dimension = require("../tree/dimension"),
          Anonymous = require("../tree/anonymous"),
          functionRegistry = require("./function-registry");
      var minMax = function(isMin, args) {
        args = Array.prototype.slice.call(args);
        switch (args.length) {
          case 0:
            throw {
              type: "Argument",
              message: "one or more arguments required"
            };
        }
        var i,
            j,
            current,
            currentUnified,
            referenceUnified,
            unit,
            unitStatic,
            unitClone,
            order = [],
            values = {};
        for (i = 0; i < args.length; i++) {
          current = args[i];
          if (!(current instanceof Dimension)) {
            if (Array.isArray(args[i].value)) {
              Array.prototype.push.apply(args, Array.prototype.slice.call(args[i].value));
            }
            continue;
          }
          currentUnified = current.unit.toString() === "" && unitClone !== undefined ? new Dimension(current.value, unitClone).unify() : current.unify();
          unit = currentUnified.unit.toString() === "" && unitStatic !== undefined ? unitStatic : currentUnified.unit.toString();
          unitStatic = unit !== "" && unitStatic === undefined || unit !== "" && order[0].unify().unit.toString() === "" ? unit : unitStatic;
          unitClone = unit !== "" && unitClone === undefined ? current.unit.toString() : unitClone;
          j = values[""] !== undefined && unit !== "" && unit === unitStatic ? values[""] : values[unit];
          if (j === undefined) {
            if (unitStatic !== undefined && unit !== unitStatic) {
              throw {
                type: "Argument",
                message: "incompatible types"
              };
            }
            values[unit] = order.length;
            order.push(current);
            continue;
          }
          referenceUnified = order[j].unit.toString() === "" && unitClone !== undefined ? new Dimension(order[j].value, unitClone).unify() : order[j].unify();
          if (isMin && currentUnified.value < referenceUnified.value || !isMin && currentUnified.value > referenceUnified.value) {
            order[j] = current;
          }
        }
        if (order.length == 1) {
          return order[0];
        }
        args = order.map(function(a) {
          return a.toCSS(this.context);
        }).join(this.context.compress ? "," : ", ");
        return new Anonymous((isMin ? "min" : "max") + "(" + args + ")");
      };
      functionRegistry.addMultiple({
        min: function() {
          return minMax(true, arguments);
        },
        max: function() {
          return minMax(false, arguments);
        },
        convert: function(val, unit) {
          return val.convertTo(unit.value);
        },
        pi: function() {
          return new Dimension(Math.PI);
        },
        mod: function(a, b) {
          return new Dimension(a.value % b.value, a.unit);
        },
        pow: function(x, y) {
          if (typeof x === "number" && typeof y === "number") {
            x = new Dimension(x);
            y = new Dimension(y);
          } else if (!(x instanceof Dimension) || !(y instanceof Dimension)) {
            throw {
              type: "Argument",
              message: "arguments must be numbers"
            };
          }
          return new Dimension(Math.pow(x.value, y.value), x.unit);
        },
        percentage: function(n) {
          return new Dimension(n.value * 100, '%');
        }
      });
    }, {
      "../tree/anonymous": 43,
      "../tree/dimension": 53,
      "./function-registry": 21
    }],
    25: [function(require, module, exports) {
      var Quoted = require("../tree/quoted"),
          Anonymous = require("../tree/anonymous"),
          JavaScript = require("../tree/javascript"),
          functionRegistry = require("./function-registry");
      functionRegistry.addMultiple({
        e: function(str) {
          return new Anonymous(str instanceof JavaScript ? str.evaluated : str.value);
        },
        escape: function(str) {
          return new Anonymous(encodeURI(str.value).replace(/=/g, "%3D").replace(/:/g, "%3A").replace(/#/g, "%23").replace(/;/g, "%3B").replace(/\(/g, "%28").replace(/\)/g, "%29"));
        },
        replace: function(string, pattern, replacement, flags) {
          var result = string.value;
          result = result.replace(new RegExp(pattern.value, flags ? flags.value : ''), replacement.value);
          return new Quoted(string.quote || '', result, string.escaped);
        },
        '%': function(string) {
          var args = Array.prototype.slice.call(arguments, 1),
              result = string.value;
          for (var i = 0; i < args.length; i++) {
            result = result.replace(/%[sda]/i, function(token) {
              var value = token.match(/s/i) ? args[i].value : args[i].toCSS();
              return token.match(/[A-Z]$/) ? encodeURIComponent(value) : value;
            });
          }
          result = result.replace(/%%/g, '%');
          return new Quoted(string.quote || '', result, string.escaped);
        }
      });
    }, {
      "../tree/anonymous": 43,
      "../tree/javascript": 60,
      "../tree/quoted": 70,
      "./function-registry": 21
    }],
    26: [function(require, module, exports) {
      module.exports = function(environment) {
        var Dimension = require("../tree/dimension"),
            Color = require("../tree/color"),
            Expression = require("../tree/expression"),
            Quoted = require("../tree/quoted"),
            URL = require("../tree/url"),
            functionRegistry = require("./function-registry");
        functionRegistry.add("svg-gradient", function(direction) {
          function throwArgumentDescriptor() {
            throw {
              type: "Argument",
              message: "svg-gradient expects direction, start_color [start_position], [color position,]...," + " end_color [end_position]"
            };
          }
          if (arguments.length < 3) {
            throwArgumentDescriptor();
          }
          var stops = Array.prototype.slice.call(arguments, 1),
              gradientDirectionSvg,
              gradientType = "linear",
              rectangleDimension = 'x="0" y="0" width="1" height="1"',
              renderEnv = {compress: false},
              returner,
              directionValue = direction.toCSS(renderEnv),
              i,
              color,
              position,
              positionValue,
              alpha;
          switch (directionValue) {
            case "to bottom":
              gradientDirectionSvg = 'x1="0%" y1="0%" x2="0%" y2="100%"';
              break;
            case "to right":
              gradientDirectionSvg = 'x1="0%" y1="0%" x2="100%" y2="0%"';
              break;
            case "to bottom right":
              gradientDirectionSvg = 'x1="0%" y1="0%" x2="100%" y2="100%"';
              break;
            case "to top right":
              gradientDirectionSvg = 'x1="0%" y1="100%" x2="100%" y2="0%"';
              break;
            case "ellipse":
            case "ellipse at center":
              gradientType = "radial";
              gradientDirectionSvg = 'cx="50%" cy="50%" r="75%"';
              rectangleDimension = 'x="-50" y="-50" width="101" height="101"';
              break;
            default:
              throw {
                type: "Argument",
                message: "svg-gradient direction must be 'to bottom', 'to right'," + " 'to bottom right', 'to top right' or 'ellipse at center'"
              };
          }
          returner = '<?xml version="1.0" ?>' + '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">' + '<' + gradientType + 'Gradient id="gradient" gradientUnits="userSpaceOnUse" ' + gradientDirectionSvg + '>';
          for (i = 0; i < stops.length; i += 1) {
            if (stops[i] instanceof Expression) {
              color = stops[i].value[0];
              position = stops[i].value[1];
            } else {
              color = stops[i];
              position = undefined;
            }
            if (!(color instanceof Color) || (!((i === 0 || i + 1 === stops.length) && position === undefined) && !(position instanceof Dimension))) {
              throwArgumentDescriptor();
            }
            positionValue = position ? position.toCSS(renderEnv) : i === 0 ? "0%" : "100%";
            alpha = color.alpha;
            returner += '<stop offset="' + positionValue + '" stop-color="' + color.toRGB() + '"' + (alpha < 1 ? ' stop-opacity="' + alpha + '"' : '') + '/>';
          }
          returner += '</' + gradientType + 'Gradient>' + '<rect ' + rectangleDimension + ' fill="url(#gradient)" /></svg>';
          returner = encodeURIComponent(returner);
          returner = "data:image/svg+xml," + returner;
          return new URL(new Quoted("'" + returner + "'", returner, false, this.index, this.currentFileInfo), this.index, this.currentFileInfo);
        });
      };
    }, {
      "../tree/color": 47,
      "../tree/dimension": 53,
      "../tree/expression": 56,
      "../tree/quoted": 70,
      "../tree/url": 77,
      "./function-registry": 21
    }],
    27: [function(require, module, exports) {
      var Keyword = require("../tree/keyword"),
          DetachedRuleset = require("../tree/detached-ruleset"),
          Dimension = require("../tree/dimension"),
          Color = require("../tree/color"),
          Quoted = require("../tree/quoted"),
          Anonymous = require("../tree/anonymous"),
          URL = require("../tree/url"),
          Operation = require("../tree/operation"),
          functionRegistry = require("./function-registry");
      var isa = function(n, Type) {
        return (n instanceof Type) ? Keyword.True : Keyword.False;
      },
          isunit = function(n, unit) {
            if (unit === undefined) {
              throw {
                type: "Argument",
                message: "missing the required second argument to isunit."
              };
            }
            unit = typeof unit.value === "string" ? unit.value : unit;
            if (typeof unit !== "string") {
              throw {
                type: "Argument",
                message: "Second argument to isunit should be a unit or a string."
              };
            }
            return (n instanceof Dimension) && n.unit.is(unit) ? Keyword.True : Keyword.False;
          },
          getItemsFromNode = function(node) {
            var items = Array.isArray(node.value) ? node.value : Array(node);
            return items.filter(function(item) {
              if (item.type === "Comment") {
                return false;
              }
              return true;
            });
          };
      functionRegistry.addMultiple({
        isruleset: function(n) {
          return isa(n, DetachedRuleset);
        },
        iscolor: function(n) {
          return isa(n, Color);
        },
        isnumber: function(n) {
          return isa(n, Dimension);
        },
        isstring: function(n) {
          return isa(n, Quoted);
        },
        iskeyword: function(n) {
          return isa(n, Keyword);
        },
        isurl: function(n) {
          return isa(n, URL);
        },
        ispixel: function(n) {
          return isunit(n, 'px');
        },
        ispercentage: function(n) {
          return isunit(n, '%');
        },
        isem: function(n) {
          return isunit(n, 'em');
        },
        isunit: isunit,
        unit: function(val, unit) {
          if (!(val instanceof Dimension)) {
            throw {
              type: "Argument",
              message: "the first argument to unit must be a number" + (val instanceof Operation ? ". Have you forgotten parenthesis?" : "")
            };
          }
          if (unit) {
            if (unit instanceof Keyword) {
              unit = unit.value;
            } else {
              unit = unit.toCSS();
            }
          } else {
            unit = "";
          }
          return new Dimension(val.value, unit);
        },
        "get-unit": function(n) {
          return new Anonymous(n.unit);
        },
        extract: function(values, index) {
          index = index.value - 1;
          return getItemsFromNode(values)[index];
        },
        length: function(values) {
          return new Dimension(getItemsFromNode(values).length);
        }
      });
    }, {
      "../tree/anonymous": 43,
      "../tree/color": 47,
      "../tree/detached-ruleset": 52,
      "../tree/dimension": 53,
      "../tree/keyword": 62,
      "../tree/operation": 68,
      "../tree/quoted": 70,
      "../tree/url": 77,
      "./function-registry": 21
    }],
    28: [function(require, module, exports) {
      var contexts = require("./contexts"),
          Parser = require('./parser/parser');
      module.exports = function(environment) {
        var ImportManager = function(context, rootFileInfo) {
          this.rootFilename = rootFileInfo.filename;
          this.paths = context.paths || [];
          this.contents = {};
          this.contentsIgnoredChars = {};
          this.mime = context.mime;
          this.error = null;
          this.context = context;
          this.queue = [];
          this.files = {};
        };
        ImportManager.prototype.push = function(path, tryAppendLessExtension, currentFileInfo, importOptions, callback) {
          var importManager = this;
          this.queue.push(path);
          var fileParsedFunc = function(e, root, fullPath) {
            importManager.queue.splice(importManager.queue.indexOf(path), 1);
            var importedEqualsRoot = fullPath === importManager.rootFilename;
            if (importOptions.optional && e) {
              callback(null, {rules: []}, false, null);
            } else {
              importManager.files[fullPath] = root;
              if (e && !importManager.error) {
                importManager.error = e;
              }
              callback(e, root, importedEqualsRoot, fullPath);
            }
          };
          var newFileInfo = {
            relativeUrls: this.context.relativeUrls,
            entryPath: currentFileInfo.entryPath,
            rootpath: currentFileInfo.rootpath,
            rootFilename: currentFileInfo.rootFilename
          };
          var fileManager = environment.getFileManager(path, currentFileInfo.currentDirectory, this.context, environment);
          if (!fileManager) {
            fileParsedFunc({message: "Could not find a file-manager for " + path});
            return ;
          }
          if (tryAppendLessExtension) {
            path = fileManager.tryAppendLessExtension(path);
          }
          var loadFileCallback = function(loadedFile) {
            var resolvedFilename = loadedFile.filename,
                contents = loadedFile.contents.replace(/^\uFEFF/, '');
            newFileInfo.currentDirectory = fileManager.getPath(resolvedFilename);
            if (newFileInfo.relativeUrls) {
              newFileInfo.rootpath = fileManager.join((importManager.context.rootpath || ""), fileManager.pathDiff(newFileInfo.currentDirectory, newFileInfo.entryPath));
              if (!fileManager.isPathAbsolute(newFileInfo.rootpath) && fileManager.alwaysMakePathsAbsolute()) {
                newFileInfo.rootpath = fileManager.join(newFileInfo.entryPath, newFileInfo.rootpath);
              }
            }
            newFileInfo.filename = resolvedFilename;
            var newEnv = new contexts.Parse(importManager.context);
            newEnv.processImports = false;
            importManager.contents[resolvedFilename] = contents;
            if (currentFileInfo.reference || importOptions.reference) {
              newFileInfo.reference = true;
            }
            if (importOptions.inline) {
              fileParsedFunc(null, contents, resolvedFilename);
            } else {
              new Parser(newEnv, importManager, newFileInfo).parse(contents, function(e, root) {
                fileParsedFunc(e, root, resolvedFilename);
              });
            }
          };
          var promise = fileManager.loadFile(path, currentFileInfo.currentDirectory, this.context, environment, function(err, loadedFile) {
            if (err) {
              fileParsedFunc(err);
            } else {
              loadFileCallback(loadedFile);
            }
          });
          if (promise) {
            promise.then(loadFileCallback, fileParsedFunc);
          }
        };
        return ImportManager;
      };
    }, {
      "./contexts": 10,
      "./parser/parser": 36
    }],
    29: [function(require, module, exports) {
      module.exports = function(environment, fileManagers) {
        var SourceMapOutput,
            SourceMapBuilder,
            ParseTree,
            ImportManager,
            Environment;
        var less = {
          version: [2, 4, 0],
          data: require('./data'),
          tree: require('./tree'),
          Environment: (Environment = require("./environment/environment")),
          AbstractFileManager: require("./environment/abstract-file-manager"),
          environment: (environment = new Environment(environment, fileManagers)),
          visitors: require('./visitors'),
          Parser: require('./parser/parser'),
          functions: require('./functions')(environment),
          contexts: require("./contexts"),
          SourceMapOutput: (SourceMapOutput = require('./source-map-output')(environment)),
          SourceMapBuilder: (SourceMapBuilder = require('./source-map-builder')(SourceMapOutput, environment)),
          ParseTree: (ParseTree = require('./parse-tree')(SourceMapBuilder)),
          ImportManager: (ImportManager = require('./import-manager')(environment)),
          render: require("./render")(environment, ParseTree, ImportManager),
          parse: require("./parse")(environment, ParseTree, ImportManager),
          LessError: require('./less-error'),
          transformTree: require('./transform-tree'),
          utils: require('./utils'),
          PluginManager: require('./plugin-manager'),
          logger: require('./logger')
        };
        return less;
      };
    }, {
      "./contexts": 10,
      "./data": 12,
      "./environment/abstract-file-manager": 14,
      "./environment/environment": 15,
      "./functions": 22,
      "./import-manager": 28,
      "./less-error": 30,
      "./logger": 31,
      "./parse": 33,
      "./parse-tree": 32,
      "./parser/parser": 36,
      "./plugin-manager": 37,
      "./render": 38,
      "./source-map-builder": 39,
      "./source-map-output": 40,
      "./transform-tree": 41,
      "./tree": 59,
      "./utils": 80,
      "./visitors": 84
    }],
    30: [function(require, module, exports) {
      var utils = require("./utils");
      var LessError = module.exports = function LessError(e, importManager, currentFilename) {
        Error.call(this);
        var filename = e.filename || currentFilename;
        if (importManager && filename) {
          var input = importManager.contents[filename],
              loc = utils.getLocation(e.index, input),
              line = loc.line,
              col = loc.column,
              callLine = e.call && utils.getLocation(e.call, input).line,
              lines = input.split('\n');
          this.type = e.type || 'Syntax';
          this.filename = filename;
          this.index = e.index;
          this.line = typeof line === 'number' ? line + 1 : null;
          this.callLine = callLine + 1;
          this.callExtract = lines[callLine];
          this.column = col;
          this.extract = [lines[line - 1], lines[line], lines[line + 1]];
        }
        this.message = e.message;
        this.stack = e.stack;
      };
      if (typeof Object.create === 'undefined') {
        var F = function() {};
        F.prototype = Error.prototype;
        LessError.prototype = new F();
      } else {
        LessError.prototype = Object.create(Error.prototype);
      }
      LessError.prototype.constructor = LessError;
    }, {"./utils": 80}],
    31: [function(require, module, exports) {
      module.exports = {
        error: function(msg) {
          this._fireEvent("error", msg);
        },
        warn: function(msg) {
          this._fireEvent("warn", msg);
        },
        info: function(msg) {
          this._fireEvent("info", msg);
        },
        debug: function(msg) {
          this._fireEvent("debug", msg);
        },
        addListener: function(listener) {
          this._listeners.push(listener);
        },
        removeListener: function(listener) {
          for (var i = 0; i < this._listeners.length; i++) {
            if (this._listeners[i] === listener) {
              this._listeners.splice(i, 1);
              return ;
            }
          }
        },
        _fireEvent: function(type, msg) {
          for (var i = 0; i < this._listeners.length; i++) {
            var logFunction = this._listeners[i][type];
            if (logFunction) {
              logFunction(msg);
            }
          }
        },
        _listeners: []
      };
    }, {}],
    32: [function(require, module, exports) {
      var LessError = require('./less-error'),
          transformTree = require("./transform-tree"),
          logger = require("./logger");
      module.exports = function(SourceMapBuilder) {
        var ParseTree = function(root, imports) {
          this.root = root;
          this.imports = imports;
        };
        ParseTree.prototype.toCSS = function(options) {
          var evaldRoot,
              result = {},
              sourceMapBuilder;
          try {
            evaldRoot = transformTree(this.root, options);
          } catch (e) {
            throw new LessError(e, this.imports);
          }
          try {
            var compress = Boolean(options.compress);
            if (compress) {
              logger.warn("The compress option has been deprecated. We recommend you use a dedicated css minifier, for instance see less-plugin-clean-css.");
            }
            var toCSSOptions = {
              compress: compress,
              dumpLineNumbers: options.dumpLineNumbers,
              strictUnits: Boolean(options.strictUnits),
              numPrecision: 8
            };
            if (options.sourceMap) {
              sourceMapBuilder = new SourceMapBuilder(options.sourceMap);
              result.css = sourceMapBuilder.toCSS(evaldRoot, toCSSOptions, this.imports);
            } else {
              result.css = evaldRoot.toCSS(toCSSOptions);
            }
          } catch (e) {
            throw new LessError(e, this.imports);
          }
          if (options.pluginManager) {
            var postProcessors = options.pluginManager.getPostProcessors();
            for (var i = 0; i < postProcessors.length; i++) {
              result.css = postProcessors[i].process(result.css, {
                sourceMap: sourceMapBuilder,
                options: options,
                imports: this.imports
              });
            }
          }
          if (options.sourceMap) {
            result.map = sourceMapBuilder.getExternalSourceMap();
          }
          result.imports = [];
          for (var file in this.imports.files) {
            if (this.imports.files.hasOwnProperty(file) && file !== this.imports.rootFilename) {
              result.imports.push(file);
            }
          }
          return result;
        };
        return ParseTree;
      };
    }, {
      "./less-error": 30,
      "./logger": 31,
      "./transform-tree": 41
    }],
    33: [function(require, module, exports) {
      var PromiseConstructor,
          contexts = require("./contexts"),
          Parser = require('./parser/parser'),
          PluginManager = require('./plugin-manager');
      module.exports = function(environment, ParseTree, ImportManager) {
        var parse = function(input, options, callback) {
          options = options || {};
          if (typeof options === 'function') {
            callback = options;
            options = {};
          }
          if (!callback) {
            if (!PromiseConstructor) {
              PromiseConstructor = typeof Promise === 'undefined' ? require('promise') : Promise;
            }
            var self = this;
            return new PromiseConstructor(function(resolve, reject) {
              parse.call(self, input, options, function(err, output) {
                if (err) {
                  reject(err);
                } else {
                  resolve(output);
                }
              });
            });
          } else {
            var context,
                rootFileInfo,
                pluginManager = new PluginManager(this);
            pluginManager.addPlugins(options.plugins);
            options.pluginManager = pluginManager;
            context = new contexts.Parse(options);
            if (options.rootFileInfo) {
              rootFileInfo = options.rootFileInfo;
            } else {
              var filename = options.filename || "input";
              var entryPath = filename.replace(/[^\/\\]*$/, "");
              rootFileInfo = {
                filename: filename,
                relativeUrls: context.relativeUrls,
                rootpath: context.rootpath || "",
                currentDirectory: entryPath,
                entryPath: entryPath,
                rootFilename: filename
              };
              if (rootFileInfo.rootpath && rootFileInfo.rootpath.slice(-1) !== "/") {
                rootFileInfo.rootpath += "/";
              }
            }
            var imports = new ImportManager(context, rootFileInfo);
            new Parser(context, imports, rootFileInfo).parse(input, function(e, root) {
              if (e) {
                return callback(e);
              }
              callback(null, root, imports, options);
            }, options);
          }
        };
        return parse;
      };
    }, {
      "./contexts": 10,
      "./parser/parser": 36,
      "./plugin-manager": 37,
      "promise": undefined
    }],
    34: [function(require, module, exports) {
      module.exports = function(input, fail) {
        var len = input.length,
            level = 0,
            parenLevel = 0,
            lastOpening,
            lastOpeningParen,
            lastMultiComment,
            lastMultiCommentEndBrace,
            chunks = [],
            emitFrom = 0,
            chunkerCurrentIndex,
            currentChunkStartIndex,
            cc,
            cc2,
            matched;
        function emitChunk(force) {
          var len = chunkerCurrentIndex - emitFrom;
          if (((len < 512) && !force) || !len) {
            return ;
          }
          chunks.push(input.slice(emitFrom, chunkerCurrentIndex + 1));
          emitFrom = chunkerCurrentIndex + 1;
        }
        for (chunkerCurrentIndex = 0; chunkerCurrentIndex < len; chunkerCurrentIndex++) {
          cc = input.charCodeAt(chunkerCurrentIndex);
          if (((cc >= 97) && (cc <= 122)) || (cc < 34)) {
            continue;
          }
          switch (cc) {
            case 40:
              parenLevel++;
              lastOpeningParen = chunkerCurrentIndex;
              continue;
            case 41:
              if (--parenLevel < 0) {
                return fail("missing opening `(`", chunkerCurrentIndex);
              }
              continue;
            case 59:
              if (!parenLevel) {
                emitChunk();
              }
              continue;
            case 123:
              level++;
              lastOpening = chunkerCurrentIndex;
              continue;
            case 125:
              if (--level < 0) {
                return fail("missing opening `{`", chunkerCurrentIndex);
              }
              if (!level && !parenLevel) {
                emitChunk();
              }
              continue;
            case 92:
              if (chunkerCurrentIndex < len - 1) {
                chunkerCurrentIndex++;
                continue;
              }
              return fail("unescaped `\\`", chunkerCurrentIndex);
            case 34:
            case 39:
            case 96:
              matched = 0;
              currentChunkStartIndex = chunkerCurrentIndex;
              for (chunkerCurrentIndex = chunkerCurrentIndex + 1; chunkerCurrentIndex < len; chunkerCurrentIndex++) {
                cc2 = input.charCodeAt(chunkerCurrentIndex);
                if (cc2 > 96) {
                  continue;
                }
                if (cc2 == cc) {
                  matched = 1;
                  break;
                }
                if (cc2 == 92) {
                  if (chunkerCurrentIndex == len - 1) {
                    return fail("unescaped `\\`", chunkerCurrentIndex);
                  }
                  chunkerCurrentIndex++;
                }
              }
              if (matched) {
                continue;
              }
              return fail("unmatched `" + String.fromCharCode(cc) + "`", currentChunkStartIndex);
            case 47:
              if (parenLevel || (chunkerCurrentIndex == len - 1)) {
                continue;
              }
              cc2 = input.charCodeAt(chunkerCurrentIndex + 1);
              if (cc2 == 47) {
                for (chunkerCurrentIndex = chunkerCurrentIndex + 2; chunkerCurrentIndex < len; chunkerCurrentIndex++) {
                  cc2 = input.charCodeAt(chunkerCurrentIndex);
                  if ((cc2 <= 13) && ((cc2 == 10) || (cc2 == 13))) {
                    break;
                  }
                }
              } else if (cc2 == 42) {
                lastMultiComment = currentChunkStartIndex = chunkerCurrentIndex;
                for (chunkerCurrentIndex = chunkerCurrentIndex + 2; chunkerCurrentIndex < len - 1; chunkerCurrentIndex++) {
                  cc2 = input.charCodeAt(chunkerCurrentIndex);
                  if (cc2 == 125) {
                    lastMultiCommentEndBrace = chunkerCurrentIndex;
                  }
                  if (cc2 != 42) {
                    continue;
                  }
                  if (input.charCodeAt(chunkerCurrentIndex + 1) == 47) {
                    break;
                  }
                }
                if (chunkerCurrentIndex == len - 1) {
                  return fail("missing closing `*/`", currentChunkStartIndex);
                }
                chunkerCurrentIndex++;
              }
              continue;
            case 42:
              if ((chunkerCurrentIndex < len - 1) && (input.charCodeAt(chunkerCurrentIndex + 1) == 47)) {
                return fail("unmatched `/*`", chunkerCurrentIndex);
              }
              continue;
          }
        }
        if (level !== 0) {
          if ((lastMultiComment > lastOpening) && (lastMultiCommentEndBrace > lastMultiComment)) {
            return fail("missing closing `}` or `*/`", lastOpening);
          } else {
            return fail("missing closing `}`", lastOpening);
          }
        } else if (parenLevel !== 0) {
          return fail("missing closing `)`", lastOpeningParen);
        }
        emitChunk(true);
        return chunks;
      };
    }, {}],
    35: [function(require, module, exports) {
      var chunker = require('./chunker');
      module.exports = function() {
        var input,
            j,
            saveStack = [],
            furthest,
            furthestPossibleErrorMessage,
            chunks,
            current,
            currentPos,
            parserInput = {};
        parserInput.save = function() {
          currentPos = parserInput.i;
          saveStack.push({
            current: current,
            i: parserInput.i,
            j: j
          });
        };
        parserInput.restore = function(possibleErrorMessage) {
          if (parserInput.i > furthest || (parserInput.i === furthest && possibleErrorMessage && !furthestPossibleErrorMessage)) {
            furthest = parserInput.i;
            furthestPossibleErrorMessage = possibleErrorMessage;
          }
          var state = saveStack.pop();
          current = state.current;
          currentPos = parserInput.i = state.i;
          j = state.j;
        };
        parserInput.forget = function() {
          saveStack.pop();
        };
        function sync() {
          if (parserInput.i > currentPos) {
            current = current.slice(parserInput.i - currentPos);
            currentPos = parserInput.i;
          }
        }
        parserInput.isWhitespace = function(offset) {
          var pos = parserInput.i + (offset || 0),
              code = input.charCodeAt(pos);
          return (code === CHARCODE_SPACE || code === CHARCODE_CR || code === CHARCODE_TAB || code === CHARCODE_LF);
        };
        parserInput.$ = function(tok) {
          var tokType = typeof tok,
              match,
              length;
          if (tokType === "string") {
            if (input.charAt(parserInput.i) !== tok) {
              return null;
            }
            skipWhitespace(1);
            return tok;
          }
          sync();
          if (!(match = tok.exec(current))) {
            return null;
          }
          length = match[0].length;
          skipWhitespace(length);
          if (typeof match === 'string') {
            return match;
          } else {
            return match.length === 1 ? match[0] : match;
          }
        };
        parserInput.$re = function(tok) {
          if (parserInput.i > currentPos) {
            current = current.slice(parserInput.i - currentPos);
            currentPos = parserInput.i;
          }
          var m = tok.exec(current);
          if (!m) {
            return null;
          }
          skipWhitespace(m[0].length);
          if (typeof m === "string") {
            return m;
          }
          return m.length === 1 ? m[0] : m;
        };
        parserInput.$char = function(tok) {
          if (input.charAt(parserInput.i) !== tok) {
            return null;
          }
          skipWhitespace(1);
          return tok;
        };
        var CHARCODE_SPACE = 32,
            CHARCODE_TAB = 9,
            CHARCODE_LF = 10,
            CHARCODE_CR = 13,
            CHARCODE_PLUS = 43,
            CHARCODE_COMMA = 44,
            CHARCODE_FORWARD_SLASH = 47,
            CHARCODE_9 = 57;
        parserInput.autoCommentAbsorb = true;
        parserInput.commentStore = [];
        parserInput.finished = false;
        var skipWhitespace = function(length) {
          var oldi = parserInput.i,
              oldj = j,
              curr = parserInput.i - currentPos,
              endIndex = parserInput.i + current.length - curr,
              mem = (parserInput.i += length),
              inp = input,
              c,
              nextChar,
              comment;
          for (; parserInput.i < endIndex; parserInput.i++) {
            c = inp.charCodeAt(parserInput.i);
            if (parserInput.autoCommentAbsorb && c === CHARCODE_FORWARD_SLASH) {
              nextChar = inp.charAt(parserInput.i + 1);
              if (nextChar === '/') {
                comment = {
                  index: parserInput.i,
                  isLineComment: true
                };
                var nextNewLine = inp.indexOf("\n", parserInput.i + 1);
                if (nextNewLine < 0) {
                  nextNewLine = endIndex;
                }
                parserInput.i = nextNewLine;
                comment.text = inp.substr(comment.i, parserInput.i - comment.i);
                parserInput.commentStore.push(comment);
                continue;
              } else if (nextChar === '*') {
                var haystack = inp.substr(parserInput.i);
                var comment_search_result = haystack.match(/^\/\*(?:[^*]|\*+[^\/*])*\*+\//);
                if (comment_search_result) {
                  comment = {
                    index: parserInput.i,
                    text: comment_search_result[0],
                    isLineComment: false
                  };
                  parserInput.i += comment.text.length - 1;
                  parserInput.commentStore.push(comment);
                  continue;
                }
              }
              break;
            }
            if ((c !== CHARCODE_SPACE) && (c !== CHARCODE_LF) && (c !== CHARCODE_TAB) && (c !== CHARCODE_CR)) {
              break;
            }
          }
          current = current.slice(length + parserInput.i - mem + curr);
          currentPos = parserInput.i;
          if (!current.length) {
            if (j < chunks.length - 1) {
              current = chunks[++j];
              skipWhitespace(0);
              return true;
            }
            parserInput.finished = true;
          }
          return oldi !== parserInput.i || oldj !== j;
        };
        parserInput.peek = function(tok) {
          if (typeof tok === 'string') {
            return input.charAt(parserInput.i) === tok;
          } else {
            return tok.test(current);
          }
        };
        parserInput.peekChar = function(tok) {
          return input.charAt(parserInput.i) === tok;
        };
        parserInput.currentChar = function() {
          return input.charAt(parserInput.i);
        };
        parserInput.getInput = function() {
          return input;
        };
        parserInput.peekNotNumeric = function() {
          var c = input.charCodeAt(parserInput.i);
          return (c > CHARCODE_9 || c < CHARCODE_PLUS) || c === CHARCODE_FORWARD_SLASH || c === CHARCODE_COMMA;
        };
        parserInput.start = function(str, chunkInput, failFunction) {
          input = str;
          parserInput.i = j = currentPos = furthest = 0;
          if (chunkInput) {
            chunks = chunker(str, failFunction);
          } else {
            chunks = [str];
          }
          current = chunks[0];
          skipWhitespace(0);
        };
        parserInput.end = function() {
          var message,
              isFinished = parserInput.i >= input.length;
          if (parserInput.i < furthest) {
            message = furthestPossibleErrorMessage;
            parserInput.i = furthest;
          }
          return {
            isFinished: isFinished,
            furthest: parserInput.i,
            furthestPossibleErrorMessage: message,
            furthestReachedEnd: parserInput.i >= input.length - 1,
            furthestChar: input[parserInput.i]
          };
        };
        return parserInput;
      };
    }, {"./chunker": 34}],
    36: [function(require, module, exports) {
      var LessError = require('../less-error'),
          tree = require("../tree"),
          visitors = require("../visitors"),
          getParserInput = require("./parser-input"),
          utils = require("../utils");
      var Parser = function Parser(context, imports, fileInfo) {
        var parsers,
            parserInput = getParserInput();
        function expect(arg, msg, index) {
          var result = (Object.prototype.toString.call(arg) === '[object Function]') ? arg.call(parsers) : parserInput.$(arg);
          if (result) {
            return result;
          }
          error(msg || (typeof arg === 'string' ? "expected '" + arg + "' got '" + parserInput.currentChar() + "'" : "unexpected token"));
        }
        function expectChar(arg, msg) {
          if (parserInput.$char(arg)) {
            return arg;
          }
          error(msg || "expected '" + arg + "' got '" + parserInput.currentChar() + "'");
        }
        function error(msg, type) {
          throw new LessError({
            index: parserInput.i,
            filename: fileInfo.filename,
            type: type || 'Syntax',
            message: msg
          }, imports);
        }
        function getDebugInfo(index) {
          var filename = fileInfo.filename;
          return {
            lineNumber: utils.getLocation(index, parserInput.getInput()).line + 1,
            fileName: filename
          };
        }
        return {
          parse: function(str, callback, additionalData) {
            var root,
                error = null,
                globalVars,
                modifyVars,
                ignored,
                preText = "";
            globalVars = (additionalData && additionalData.globalVars) ? Parser.serializeVars(additionalData.globalVars) + '\n' : '';
            modifyVars = (additionalData && additionalData.modifyVars) ? '\n' + Parser.serializeVars(additionalData.modifyVars) : '';
            if (context.pluginManager) {
              var preProcessors = context.pluginManager.getPreProcessors();
              for (var i = 0; i < preProcessors.length; i++) {
                str = preProcessors[i].process(str, {
                  context: context,
                  imports: imports,
                  fileInfo: fileInfo
                });
              }
            }
            if (globalVars || (additionalData && additionalData.banner)) {
              preText = ((additionalData && additionalData.banner) ? additionalData.banner : "") + globalVars;
              ignored = imports.contentsIgnoredChars;
              ignored[fileInfo.filename] = ignored[fileInfo.filename] || 0;
              ignored[fileInfo.filename] += preText.length;
            }
            str = str.replace(/\r\n?/g, '\n');
            str = preText + str.replace(/^\uFEFF/, '') + modifyVars;
            imports.contents[fileInfo.filename] = str;
            try {
              parserInput.start(str, context.chunkInput, function fail(msg, index) {
                throw LessError({
                  index: index,
                  type: 'Parse',
                  message: msg,
                  filename: fileInfo.filename
                }, imports);
              });
              root = new (tree.Ruleset)(null, this.parsers.primary());
              root.root = true;
              root.firstRoot = true;
            } catch (e) {
              return callback(new LessError(e, imports, fileInfo.filename));
            }
            var endInfo = parserInput.end();
            if (!endInfo.isFinished) {
              var message = endInfo.furthestPossibleErrorMessage;
              if (!message) {
                message = "Unrecognised input";
                if (endInfo.furthestChar === '}') {
                  message += ". Possibly missing opening '{'";
                } else if (endInfo.furthestChar === ')') {
                  message += ". Possibly missing opening '('";
                } else if (endInfo.furthestReachedEnd) {
                  message += ". Possibly missing something";
                }
              }
              error = new LessError({
                type: "Parse",
                message: message,
                index: endInfo.furthest,
                filename: fileInfo.filename
              }, imports);
            }
            var finish = function(e) {
              e = error || e || imports.error;
              if (e) {
                if (!(e instanceof LessError)) {
                  e = new LessError(e, imports, fileInfo.filename);
                }
                return callback(e);
              } else {
                return callback(null, root);
              }
            };
            if (context.processImports !== false) {
              new visitors.ImportVisitor(imports, finish).run(root);
            } else {
              return finish();
            }
          },
          parsers: parsers = {
            primary: function() {
              var mixin = this.mixin,
                  root = [],
                  node;
              while (true) {
                while (true) {
                  node = this.comment();
                  if (!node) {
                    break;
                  }
                  root.push(node);
                }
                if (parserInput.finished) {
                  break;
                }
                if (parserInput.peek('}')) {
                  break;
                }
                node = this.extendRule();
                if (node) {
                  root = root.concat(node);
                  continue;
                }
                node = mixin.definition() || this.rule() || this.ruleset() || mixin.call() || this.rulesetCall() || this.directive();
                if (node) {
                  root.push(node);
                } else {
                  if (!(parserInput.$re(/^[\s\n]+/) || parserInput.$re(/^;+/))) {
                    break;
                  }
                }
              }
              return root;
            },
            comment: function() {
              if (parserInput.commentStore.length) {
                var comment = parserInput.commentStore.shift();
                return new (tree.Comment)(comment.text, comment.isLineComment, comment.index, fileInfo);
              }
            },
            entities: {
              quoted: function() {
                var str,
                    index = parserInput.i;
                str = parserInput.$re(/^(~)?("((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)')/);
                if (str) {
                  return new (tree.Quoted)(str[2], str[3] || str[4], Boolean(str[1]), index, fileInfo);
                }
              },
              keyword: function() {
                var k = parserInput.$re(/^%|^[_A-Za-z-][_A-Za-z0-9-]*/);
                if (k) {
                  return tree.Color.fromKeyword(k) || new (tree.Keyword)(k);
                }
              },
              call: function() {
                var name,
                    nameLC,
                    args,
                    alpha,
                    index = parserInput.i;
                if (parserInput.peek(/^url\(/i)) {
                  return ;
                }
                parserInput.save();
                name = parserInput.$re(/^([\w-]+|%|progid:[\w\.]+)\(/);
                if (!name) {
                  parserInput.forget();
                  return ;
                }
                name = name[1];
                nameLC = name.toLowerCase();
                if (nameLC === 'alpha') {
                  alpha = parsers.alpha();
                  if (alpha) {
                    return alpha;
                  }
                }
                args = this.arguments();
                if (!parserInput.$char(')')) {
                  parserInput.restore("Could not parse call arguments or missing ')'");
                  return ;
                }
                parserInput.forget();
                return new (tree.Call)(name, args, index, fileInfo);
              },
              arguments: function() {
                var args = [],
                    arg;
                while (true) {
                  arg = this.assignment() || parsers.expression();
                  if (!arg) {
                    break;
                  }
                  args.push(arg);
                  if (!parserInput.$char(',')) {
                    break;
                  }
                }
                return args;
              },
              literal: function() {
                return this.dimension() || this.color() || this.quoted() || this.unicodeDescriptor();
              },
              assignment: function() {
                var key,
                    value;
                key = parserInput.$re(/^\w+(?=\s?=)/i);
                if (!key) {
                  return ;
                }
                if (!parserInput.$char('=')) {
                  return ;
                }
                value = parsers.entity();
                if (value) {
                  return new (tree.Assignment)(key, value);
                }
              },
              url: function() {
                var value,
                    index = parserInput.i;
                parserInput.autoCommentAbsorb = false;
                if (parserInput.currentChar() !== 'u' || !parserInput.$re(/^url\(/)) {
                  parserInput.autoCommentAbsorb = true;
                  return ;
                }
                value = this.quoted() || this.variable() || parserInput.$re(/^(?:(?:\\[\(\)'"])|[^\(\)'"])+/) || "";
                parserInput.autoCommentAbsorb = true;
                expectChar(')');
                return new (tree.URL)((value.value != null || value instanceof tree.Variable) ? value : new (tree.Anonymous)(value), index, fileInfo);
              },
              variable: function() {
                var name,
                    index = parserInput.i;
                if (parserInput.currentChar() === '@' && (name = parserInput.$re(/^@@?[\w-]+/))) {
                  return new (tree.Variable)(name, index, fileInfo);
                }
              },
              variableCurly: function() {
                var curly,
                    index = parserInput.i;
                if (parserInput.currentChar() === '@' && (curly = parserInput.$re(/^@\{([\w-]+)\}/))) {
                  return new (tree.Variable)("@" + curly[1], index, fileInfo);
                }
              },
              color: function() {
                var rgb;
                if (parserInput.currentChar() === '#' && (rgb = parserInput.$re(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})/))) {
                  var colorCandidateString = rgb.input.match(/^#([\w]+).*/);
                  colorCandidateString = colorCandidateString[1];
                  if (!colorCandidateString.match(/^[A-Fa-f0-9]+$/)) {
                    error("Invalid HEX color code");
                  }
                  return new (tree.Color)(rgb[1]);
                }
              },
              dimension: function() {
                if (parserInput.peekNotNumeric()) {
                  return ;
                }
                var value = parserInput.$re(/^([+-]?\d*\.?\d+)(%|[a-z]+)?/i);
                if (value) {
                  return new (tree.Dimension)(value[1], value[2]);
                }
              },
              unicodeDescriptor: function() {
                var ud;
                ud = parserInput.$re(/^U\+[0-9a-fA-F?]+(\-[0-9a-fA-F?]+)?/);
                if (ud) {
                  return new (tree.UnicodeDescriptor)(ud[0]);
                }
              },
              javascript: function() {
                var js,
                    index = parserInput.i;
                js = parserInput.$re(/^(~)?`([^`]*)`/);
                if (js) {
                  return new (tree.JavaScript)(js[2], Boolean(js[1]), index, fileInfo);
                }
              }
            },
            variable: function() {
              var name;
              if (parserInput.currentChar() === '@' && (name = parserInput.$re(/^(@[\w-]+)\s*:/))) {
                return name[1];
              }
            },
            rulesetCall: function() {
              var name;
              if (parserInput.currentChar() === '@' && (name = parserInput.$re(/^(@[\w-]+)\s*\(\s*\)\s*;/))) {
                return new tree.RulesetCall(name[1]);
              }
            },
            extend: function(isRule) {
              var elements,
                  e,
                  index = parserInput.i,
                  option,
                  extendList,
                  extend;
              if (!(isRule ? parserInput.$re(/^&:extend\(/) : parserInput.$re(/^:extend\(/))) {
                return ;
              }
              do {
                option = null;
                elements = null;
                while (!(option = parserInput.$re(/^(all)(?=\s*(\)|,))/))) {
                  e = this.element();
                  if (!e) {
                    break;
                  }
                  if (elements) {
                    elements.push(e);
                  } else {
                    elements = [e];
                  }
                }
                option = option && option[1];
                if (!elements) {
                  error("Missing target selector for :extend().");
                }
                extend = new (tree.Extend)(new (tree.Selector)(elements), option, index);
                if (extendList) {
                  extendList.push(extend);
                } else {
                  extendList = [extend];
                }
              } while (parserInput.$char(","));
              expect(/^\)/);
              if (isRule) {
                expect(/^;/);
              }
              return extendList;
            },
            extendRule: function() {
              return this.extend(true);
            },
            mixin: {
              call: function() {
                var s = parserInput.currentChar(),
                    important = false,
                    index = parserInput.i,
                    elemIndex,
                    elements,
                    elem,
                    e,
                    c,
                    args;
                if (s !== '.' && s !== '#') {
                  return ;
                }
                parserInput.save();
                while (true) {
                  elemIndex = parserInput.i;
                  e = parserInput.$re(/^[#.](?:[\w-]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+/);
                  if (!e) {
                    break;
                  }
                  elem = new (tree.Element)(c, e, elemIndex, fileInfo);
                  if (elements) {
                    elements.push(elem);
                  } else {
                    elements = [elem];
                  }
                  c = parserInput.$char('>');
                }
                if (elements) {
                  if (parserInput.$char('(')) {
                    args = this.args(true).args;
                    expectChar(')');
                  }
                  if (parsers.important()) {
                    important = true;
                  }
                  if (parsers.end()) {
                    parserInput.forget();
                    return new (tree.mixin.Call)(elements, args, index, fileInfo, important);
                  }
                }
                parserInput.restore();
              },
              args: function(isCall) {
                var entities = parsers.entities,
                    returner = {
                      args: null,
                      variadic: false
                    },
                    expressions = [],
                    argsSemiColon = [],
                    argsComma = [],
                    isSemiColonSeparated,
                    expressionContainsNamed,
                    name,
                    nameLoop,
                    value,
                    arg;
                parserInput.save();
                while (true) {
                  if (isCall) {
                    arg = parsers.detachedRuleset() || parsers.expression();
                  } else {
                    parserInput.commentStore.length = 0;
                    if (parserInput.currentChar() === '.' && parserInput.$re(/^\.{3}/)) {
                      returner.variadic = true;
                      if (parserInput.$char(";") && !isSemiColonSeparated) {
                        isSemiColonSeparated = true;
                      }
                      (isSemiColonSeparated ? argsSemiColon : argsComma).push({variadic: true});
                      break;
                    }
                    arg = entities.variable() || entities.literal() || entities.keyword();
                  }
                  if (!arg) {
                    break;
                  }
                  nameLoop = null;
                  if (arg.throwAwayComments) {
                    arg.throwAwayComments();
                  }
                  value = arg;
                  var val = null;
                  if (isCall) {
                    if (arg.value && arg.value.length == 1) {
                      val = arg.value[0];
                    }
                  } else {
                    val = arg;
                  }
                  if (val && val instanceof tree.Variable) {
                    if (parserInput.$char(':')) {
                      if (expressions.length > 0) {
                        if (isSemiColonSeparated) {
                          error("Cannot mix ; and , as delimiter types");
                        }
                        expressionContainsNamed = true;
                      }
                      value = (isCall && parsers.detachedRuleset()) || parsers.expression();
                      if (!value) {
                        if (isCall) {
                          error("could not understand value for named argument");
                        } else {
                          parserInput.restore();
                          returner.args = [];
                          return returner;
                        }
                      }
                      nameLoop = (name = val.name);
                    } else if (!isCall && parserInput.$re(/^\.{3}/)) {
                      returner.variadic = true;
                      if (parserInput.$char(";") && !isSemiColonSeparated) {
                        isSemiColonSeparated = true;
                      }
                      (isSemiColonSeparated ? argsSemiColon : argsComma).push({
                        name: arg.name,
                        variadic: true
                      });
                      break;
                    } else if (!isCall) {
                      name = nameLoop = val.name;
                      value = null;
                    }
                  }
                  if (value) {
                    expressions.push(value);
                  }
                  argsComma.push({
                    name: nameLoop,
                    value: value
                  });
                  if (parserInput.$char(',')) {
                    continue;
                  }
                  if (parserInput.$char(';') || isSemiColonSeparated) {
                    if (expressionContainsNamed) {
                      error("Cannot mix ; and , as delimiter types");
                    }
                    isSemiColonSeparated = true;
                    if (expressions.length > 1) {
                      value = new (tree.Value)(expressions);
                    }
                    argsSemiColon.push({
                      name: name,
                      value: value
                    });
                    name = null;
                    expressions = [];
                    expressionContainsNamed = false;
                  }
                }
                parserInput.forget();
                returner.args = isSemiColonSeparated ? argsSemiColon : argsComma;
                return returner;
              },
              definition: function() {
                var name,
                    params = [],
                    match,
                    ruleset,
                    cond,
                    variadic = false;
                if ((parserInput.currentChar() !== '.' && parserInput.currentChar() !== '#') || parserInput.peek(/^[^{]*\}/)) {
                  return ;
                }
                parserInput.save();
                match = parserInput.$re(/^([#.](?:[\w-]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+)\s*\(/);
                if (match) {
                  name = match[1];
                  var argInfo = this.args(false);
                  params = argInfo.args;
                  variadic = argInfo.variadic;
                  if (!parserInput.$char(')')) {
                    parserInput.restore("Missing closing ')'");
                    return ;
                  }
                  parserInput.commentStore.length = 0;
                  if (parserInput.$re(/^when/)) {
                    cond = expect(parsers.conditions, 'expected condition');
                  }
                  ruleset = parsers.block();
                  if (ruleset) {
                    parserInput.forget();
                    return new (tree.mixin.Definition)(name, params, ruleset, cond, variadic);
                  } else {
                    parserInput.restore();
                  }
                } else {
                  parserInput.forget();
                }
              }
            },
            entity: function() {
              var entities = this.entities;
              return this.comment() || entities.literal() || entities.variable() || entities.url() || entities.call() || entities.keyword() || entities.javascript();
            },
            end: function() {
              return parserInput.$char(';') || parserInput.peek('}');
            },
            alpha: function() {
              var value;
              if (!parserInput.$re(/^opacity=/i)) {
                return ;
              }
              value = parserInput.$re(/^\d+/);
              if (!value) {
                value = expect(this.entities.variable, "Could not parse alpha");
              }
              expectChar(')');
              return new (tree.Alpha)(value);
            },
            element: function() {
              var e,
                  c,
                  v,
                  index = parserInput.i;
              c = this.combinator();
              e = parserInput.$re(/^(?:\d+\.\d+|\d+)%/) || parserInput.$re(/^(?:[.#]?|:*)(?:[\w-]|[^\x00-\x9f]|\\(?:[A-Fa-f0-9]{1,6} ?|[^A-Fa-f0-9]))+/) || parserInput.$char('*') || parserInput.$char('&') || this.attribute() || parserInput.$re(/^\([^&()@]+\)/) || parserInput.$re(/^[\.#:](?=@)/) || this.entities.variableCurly();
              if (!e) {
                parserInput.save();
                if (parserInput.$char('(')) {
                  if ((v = this.selector()) && parserInput.$char(')')) {
                    e = new (tree.Paren)(v);
                    parserInput.forget();
                  } else {
                    parserInput.restore("Missing closing ')'");
                  }
                } else {
                  parserInput.forget();
                }
              }
              if (e) {
                return new (tree.Element)(c, e, index, fileInfo);
              }
            },
            combinator: function() {
              var c = parserInput.currentChar();
              if (c === '/') {
                parserInput.save();
                var slashedCombinator = parserInput.$re(/^\/[a-z]+\//i);
                if (slashedCombinator) {
                  parserInput.forget();
                  return new (tree.Combinator)(slashedCombinator);
                }
                parserInput.restore();
              }
              if (c === '>' || c === '+' || c === '~' || c === '|' || c === '^') {
                parserInput.i++;
                if (c === '^' && parserInput.currentChar() === '^') {
                  c = '^^';
                  parserInput.i++;
                }
                while (parserInput.isWhitespace()) {
                  parserInput.i++;
                }
                return new (tree.Combinator)(c);
              } else if (parserInput.isWhitespace(-1)) {
                return new (tree.Combinator)(" ");
              } else {
                return new (tree.Combinator)(null);
              }
            },
            lessSelector: function() {
              return this.selector(true);
            },
            selector: function(isLess) {
              var index = parserInput.i,
                  elements,
                  extendList,
                  c,
                  e,
                  allExtends,
                  when,
                  condition;
              while ((isLess && (extendList = this.extend())) || (isLess && (when = parserInput.$re(/^when/))) || (e = this.element())) {
                if (when) {
                  condition = expect(this.conditions, 'expected condition');
                } else if (condition) {
                  error("CSS guard can only be used at the end of selector");
                } else if (extendList) {
                  if (allExtends) {
                    allExtends = allExtends.concat(extendList);
                  } else {
                    allExtends = extendList;
                  }
                } else {
                  if (allExtends) {
                    error("Extend can only be used at the end of selector");
                  }
                  c = parserInput.currentChar();
                  if (elements) {
                    elements.push(e);
                  } else {
                    elements = [e];
                  }
                  e = null;
                }
                if (c === '{' || c === '}' || c === ';' || c === ',' || c === ')') {
                  break;
                }
              }
              if (elements) {
                return new (tree.Selector)(elements, allExtends, condition, index, fileInfo);
              }
              if (allExtends) {
                error("Extend must be used to extend a selector, it cannot be used on its own");
              }
            },
            attribute: function() {
              if (!parserInput.$char('[')) {
                return ;
              }
              var entities = this.entities,
                  key,
                  val,
                  op;
              if (!(key = entities.variableCurly())) {
                key = expect(/^(?:[_A-Za-z0-9-\*]*\|)?(?:[_A-Za-z0-9-]|\\.)+/);
              }
              op = parserInput.$re(/^[|~*$^]?=/);
              if (op) {
                val = entities.quoted() || parserInput.$re(/^[0-9]+%/) || parserInput.$re(/^[\w-]+/) || entities.variableCurly();
              }
              expectChar(']');
              return new (tree.Attribute)(key, op, val);
            },
            block: function() {
              var content;
              if (parserInput.$char('{') && (content = this.primary()) && parserInput.$char('}')) {
                return content;
              }
            },
            blockRuleset: function() {
              var block = this.block();
              if (block) {
                block = new tree.Ruleset(null, block);
              }
              return block;
            },
            detachedRuleset: function() {
              var blockRuleset = this.blockRuleset();
              if (blockRuleset) {
                return new tree.DetachedRuleset(blockRuleset);
              }
            },
            ruleset: function() {
              var selectors,
                  s,
                  rules,
                  debugInfo;
              parserInput.save();
              if (context.dumpLineNumbers) {
                debugInfo = getDebugInfo(parserInput.i);
              }
              while (true) {
                s = this.lessSelector();
                if (!s) {
                  break;
                }
                if (selectors) {
                  selectors.push(s);
                } else {
                  selectors = [s];
                }
                parserInput.commentStore.length = 0;
                if (s.condition && selectors.length > 1) {
                  error("Guards are only currently allowed on a single selector.");
                }
                if (!parserInput.$char(',')) {
                  break;
                }
                if (s.condition) {
                  error("Guards are only currently allowed on a single selector.");
                }
                parserInput.commentStore.length = 0;
              }
              if (selectors && (rules = this.block())) {
                parserInput.forget();
                var ruleset = new (tree.Ruleset)(selectors, rules, context.strictImports);
                if (context.dumpLineNumbers) {
                  ruleset.debugInfo = debugInfo;
                }
                return ruleset;
              } else {
                parserInput.restore();
              }
            },
            rule: function(tryAnonymous) {
              var name,
                  value,
                  startOfRule = parserInput.i,
                  c = parserInput.currentChar(),
                  important,
                  merge,
                  isVariable;
              if (c === '.' || c === '#' || c === '&') {
                return ;
              }
              parserInput.save();
              name = this.variable() || this.ruleProperty();
              if (name) {
                isVariable = typeof name === "string";
                if (isVariable) {
                  value = this.detachedRuleset();
                }
                parserInput.commentStore.length = 0;
                if (!value) {
                  merge = !isVariable && name.pop().value;
                  var tryValueFirst = !tryAnonymous && (context.compress || isVariable);
                  if (tryValueFirst) {
                    value = this.value();
                  }
                  if (!value) {
                    value = this.anonymousValue();
                    if (value) {
                      parserInput.forget();
                      return new (tree.Rule)(name, value, false, merge, startOfRule, fileInfo);
                    }
                  }
                  if (!tryValueFirst && !value) {
                    value = this.value();
                  }
                  important = this.important();
                }
                if (value && this.end()) {
                  parserInput.forget();
                  return new (tree.Rule)(name, value, important, merge, startOfRule, fileInfo);
                } else {
                  parserInput.restore();
                  if (value && !tryAnonymous) {
                    return this.rule(true);
                  }
                }
              } else {
                parserInput.forget();
              }
            },
            anonymousValue: function() {
              var match = parserInput.$re(/^([^@+\/'"*`(;{}-]*);/);
              if (match) {
                return new (tree.Anonymous)(match[1]);
              }
            },
            "import": function() {
              var path,
                  features,
                  index = parserInput.i;
              var dir = parserInput.$re(/^@import?\s+/);
              if (dir) {
                var options = (dir ? this.importOptions() : null) || {};
                if ((path = this.entities.quoted() || this.entities.url())) {
                  features = this.mediaFeatures();
                  if (!parserInput.$(';')) {
                    parserInput.i = index;
                    error("missing semi-colon or unrecognised media features on import");
                  }
                  features = features && new (tree.Value)(features);
                  return new (tree.Import)(path, features, options, index, fileInfo);
                } else {
                  parserInput.i = index;
                  error("malformed import statement");
                }
              }
            },
            importOptions: function() {
              var o,
                  options = {},
                  optionName,
                  value;
              if (!parserInput.$char('(')) {
                return null;
              }
              do {
                o = this.importOption();
                if (o) {
                  optionName = o;
                  value = true;
                  switch (optionName) {
                    case "css":
                      optionName = "less";
                      value = false;
                      break;
                    case "once":
                      optionName = "multiple";
                      value = false;
                      break;
                  }
                  options[optionName] = value;
                  if (!parserInput.$char(',')) {
                    break;
                  }
                }
              } while (o);
              expectChar(')');
              return options;
            },
            importOption: function() {
              var opt = parserInput.$re(/^(less|css|multiple|once|inline|reference|optional)/);
              if (opt) {
                return opt[1];
              }
            },
            mediaFeature: function() {
              var entities = this.entities,
                  nodes = [],
                  e,
                  p;
              parserInput.save();
              do {
                e = entities.keyword() || entities.variable();
                if (e) {
                  nodes.push(e);
                } else if (parserInput.$char('(')) {
                  p = this.property();
                  e = this.value();
                  if (parserInput.$char(')')) {
                    if (p && e) {
                      nodes.push(new (tree.Paren)(new (tree.Rule)(p, e, null, null, parserInput.i, fileInfo, true)));
                    } else if (e) {
                      nodes.push(new (tree.Paren)(e));
                    } else {
                      parserInput.restore("badly formed media feature definition");
                      return null;
                    }
                  } else {
                    parserInput.restore("Missing closing ')'");
                    return null;
                  }
                }
              } while (e);
              parserInput.forget();
              if (nodes.length > 0) {
                return new (tree.Expression)(nodes);
              }
            },
            mediaFeatures: function() {
              var entities = this.entities,
                  features = [],
                  e;
              do {
                e = this.mediaFeature();
                if (e) {
                  features.push(e);
                  if (!parserInput.$char(',')) {
                    break;
                  }
                } else {
                  e = entities.variable();
                  if (e) {
                    features.push(e);
                    if (!parserInput.$char(',')) {
                      break;
                    }
                  }
                }
              } while (e);
              return features.length > 0 ? features : null;
            },
            media: function() {
              var features,
                  rules,
                  media,
                  debugInfo;
              if (context.dumpLineNumbers) {
                debugInfo = getDebugInfo(parserInput.i);
              }
              if (parserInput.$re(/^@media/)) {
                features = this.mediaFeatures();
                rules = this.block();
                if (rules) {
                  media = new (tree.Media)(rules, features, parserInput.i, fileInfo);
                  if (context.dumpLineNumbers) {
                    media.debugInfo = debugInfo;
                  }
                  return media;
                }
              }
            },
            directive: function() {
              var index = parserInput.i,
                  name,
                  value,
                  rules,
                  nonVendorSpecificName,
                  hasIdentifier,
                  hasExpression,
                  hasUnknown,
                  hasBlock = true;
              if (parserInput.currentChar() !== '@') {
                return ;
              }
              value = this['import']() || this.media();
              if (value) {
                return value;
              }
              parserInput.save();
              name = parserInput.$re(/^@[a-z-]+/);
              if (!name) {
                return ;
              }
              nonVendorSpecificName = name;
              if (name.charAt(1) == '-' && name.indexOf('-', 2) > 0) {
                nonVendorSpecificName = "@" + name.slice(name.indexOf('-', 2) + 1);
              }
              switch (nonVendorSpecificName) {
                case "@counter-style":
                  hasIdentifier = true;
                  hasBlock = true;
                  break;
                case "@charset":
                  hasIdentifier = true;
                  hasBlock = false;
                  break;
                case "@namespace":
                  hasExpression = true;
                  hasBlock = false;
                  break;
                case "@keyframes":
                  hasIdentifier = true;
                  break;
                case "@host":
                case "@page":
                case "@document":
                case "@supports":
                  hasUnknown = true;
                  break;
              }
              parserInput.commentStore.length = 0;
              if (hasIdentifier) {
                value = this.entity();
                if (!value) {
                  error("expected " + name + " identifier");
                }
              } else if (hasExpression) {
                value = this.expression();
                if (!value) {
                  error("expected " + name + " expression");
                }
              } else if (hasUnknown) {
                value = (parserInput.$re(/^[^{;]+/) || '').trim();
                if (value) {
                  value = new (tree.Anonymous)(value);
                }
              }
              if (hasBlock) {
                rules = this.blockRuleset();
              }
              if (rules || (!hasBlock && value && parserInput.$char(';'))) {
                parserInput.forget();
                return new (tree.Directive)(name, value, rules, index, fileInfo, context.dumpLineNumbers ? getDebugInfo(index) : null);
              }
              parserInput.restore("directive options not recognised");
            },
            value: function() {
              var e,
                  expressions = [];
              do {
                e = this.expression();
                if (e) {
                  expressions.push(e);
                  if (!parserInput.$char(',')) {
                    break;
                  }
                }
              } while (e);
              if (expressions.length > 0) {
                return new (tree.Value)(expressions);
              }
            },
            important: function() {
              if (parserInput.currentChar() === '!') {
                return parserInput.$re(/^! *important/);
              }
            },
            sub: function() {
              var a,
                  e;
              parserInput.save();
              if (parserInput.$char('(')) {
                a = this.addition();
                if (a && parserInput.$char(')')) {
                  parserInput.forget();
                  e = new (tree.Expression)([a]);
                  e.parens = true;
                  return e;
                }
                parserInput.restore("Expected ')'");
                return ;
              }
              parserInput.restore();
            },
            multiplication: function() {
              var m,
                  a,
                  op,
                  operation,
                  isSpaced;
              m = this.operand();
              if (m) {
                isSpaced = parserInput.isWhitespace(-1);
                while (true) {
                  if (parserInput.peek(/^\/[*\/]/)) {
                    break;
                  }
                  parserInput.save();
                  op = parserInput.$char('/') || parserInput.$char('*');
                  if (!op) {
                    parserInput.forget();
                    break;
                  }
                  a = this.operand();
                  if (!a) {
                    parserInput.restore();
                    break;
                  }
                  parserInput.forget();
                  m.parensInOp = true;
                  a.parensInOp = true;
                  operation = new (tree.Operation)(op, [operation || m, a], isSpaced);
                  isSpaced = parserInput.isWhitespace(-1);
                }
                return operation || m;
              }
            },
            addition: function() {
              var m,
                  a,
                  op,
                  operation,
                  isSpaced;
              m = this.multiplication();
              if (m) {
                isSpaced = parserInput.isWhitespace(-1);
                while (true) {
                  op = parserInput.$re(/^[-+]\s+/) || (!isSpaced && (parserInput.$char('+') || parserInput.$char('-')));
                  if (!op) {
                    break;
                  }
                  a = this.multiplication();
                  if (!a) {
                    break;
                  }
                  m.parensInOp = true;
                  a.parensInOp = true;
                  operation = new (tree.Operation)(op, [operation || m, a], isSpaced);
                  isSpaced = parserInput.isWhitespace(-1);
                }
                return operation || m;
              }
            },
            conditions: function() {
              var a,
                  b,
                  index = parserInput.i,
                  condition;
              a = this.condition();
              if (a) {
                while (true) {
                  if (!parserInput.peek(/^,\s*(not\s*)?\(/) || !parserInput.$char(',')) {
                    break;
                  }
                  b = this.condition();
                  if (!b) {
                    break;
                  }
                  condition = new (tree.Condition)('or', condition || a, b, index);
                }
                return condition || a;
              }
            },
            condition: function() {
              var entities = this.entities,
                  index = parserInput.i,
                  negate = false,
                  a,
                  b,
                  c,
                  op;
              if (parserInput.$re(/^not/)) {
                negate = true;
              }
              expectChar('(');
              a = this.addition() || entities.keyword() || entities.quoted();
              if (a) {
                op = parserInput.$re(/^(?:>=|<=|=<|[<=>])/);
                if (op) {
                  b = this.addition() || entities.keyword() || entities.quoted();
                  if (b) {
                    c = new (tree.Condition)(op, a, b, index, negate);
                  } else {
                    error('expected expression');
                  }
                } else {
                  c = new (tree.Condition)('=', a, new (tree.Keyword)('true'), index, negate);
                }
                expectChar(')');
                return parserInput.$re(/^and/) ? new (tree.Condition)('and', c, this.condition()) : c;
              }
            },
            operand: function() {
              var entities = this.entities,
                  negate;
              if (parserInput.peek(/^-[@\(]/)) {
                negate = parserInput.$char('-');
              }
              var o = this.sub() || entities.dimension() || entities.color() || entities.variable() || entities.call();
              if (negate) {
                o.parensInOp = true;
                o = new (tree.Negative)(o);
              }
              return o;
            },
            expression: function() {
              var entities = [],
                  e,
                  delim;
              do {
                e = this.comment();
                if (e) {
                  entities.push(e);
                  continue;
                }
                e = this.addition() || this.entity();
                if (e) {
                  entities.push(e);
                  if (!parserInput.peek(/^\/[\/*]/)) {
                    delim = parserInput.$char('/');
                    if (delim) {
                      entities.push(new (tree.Anonymous)(delim));
                    }
                  }
                }
              } while (e);
              if (entities.length > 0) {
                return new (tree.Expression)(entities);
              }
            },
            property: function() {
              var name = parserInput.$re(/^(\*?-?[_a-zA-Z0-9-]+)\s*:/);
              if (name) {
                return name[1];
              }
            },
            ruleProperty: function() {
              var name = [],
                  index = [],
                  s,
                  k;
              parserInput.save();
              function match(re) {
                var i = parserInput.i,
                    chunk = parserInput.$re(re);
                if (chunk) {
                  index.push(i);
                  return name.push(chunk[1]);
                }
              }
              match(/^(\*?)/);
              while (true) {
                if (!match(/^((?:[\w-]+)|(?:@\{[\w-]+\}))/)) {
                  break;
                }
              }
              if ((name.length > 1) && match(/^((?:\+_|\+)?)\s*:/)) {
                parserInput.forget();
                if (name[0] === '') {
                  name.shift();
                  index.shift();
                }
                for (k = 0; k < name.length; k++) {
                  s = name[k];
                  name[k] = (s.charAt(0) !== '@') ? new (tree.Keyword)(s) : new (tree.Variable)('@' + s.slice(2, -1), index[k], fileInfo);
                }
                return name;
              }
              parserInput.restore();
            }
          }
        };
      };
      Parser.serializeVars = function(vars) {
        var s = '';
        for (var name in vars) {
          if (Object.hasOwnProperty.call(vars, name)) {
            var value = vars[name];
            s += ((name[0] === '@') ? '' : '@') + name + ': ' + value + ((String(value).slice(-1) === ';') ? '' : ';');
          }
        }
        return s;
      };
      module.exports = Parser;
    }, {
      "../less-error": 30,
      "../tree": 59,
      "../utils": 80,
      "../visitors": 84,
      "./parser-input": 35
    }],
    37: [function(require, module, exports) {
      var PluginManager = function(less) {
        this.less = less;
        this.visitors = [];
        this.preProcessors = [];
        this.postProcessors = [];
        this.installedPlugins = [];
        this.fileManagers = [];
      };
      PluginManager.prototype.addPlugins = function(plugins) {
        if (plugins) {
          for (var i = 0; i < plugins.length; i++) {
            this.addPlugin(plugins[i]);
          }
        }
      };
      PluginManager.prototype.addPlugin = function(plugin) {
        this.installedPlugins.push(plugin);
        plugin.install(this.less, this);
      };
      PluginManager.prototype.addVisitor = function(visitor) {
        this.visitors.push(visitor);
      };
      PluginManager.prototype.addPreProcessor = function(preProcessor, priority) {
        var indexToInsertAt;
        for (indexToInsertAt = 0; indexToInsertAt < this.preProcessors.length; indexToInsertAt++) {
          if (this.preProcessors[indexToInsertAt].priority >= priority) {
            break;
          }
        }
        this.preProcessors.splice(indexToInsertAt, 0, {
          preProcessor: preProcessor,
          priority: priority
        });
      };
      PluginManager.prototype.addPostProcessor = function(postProcessor, priority) {
        var indexToInsertAt;
        for (indexToInsertAt = 0; indexToInsertAt < this.postProcessors.length; indexToInsertAt++) {
          if (this.postProcessors[indexToInsertAt].priority >= priority) {
            break;
          }
        }
        this.postProcessors.splice(indexToInsertAt, 0, {
          postProcessor: postProcessor,
          priority: priority
        });
      };
      PluginManager.prototype.addFileManager = function(manager) {
        this.fileManagers.push(manager);
      };
      PluginManager.prototype.getPreProcessors = function() {
        var preProcessors = [];
        for (var i = 0; i < this.preProcessors.length; i++) {
          preProcessors.push(this.preProcessors[i].preProcessor);
        }
        return preProcessors;
      };
      PluginManager.prototype.getPostProcessors = function() {
        var postProcessors = [];
        for (var i = 0; i < this.postProcessors.length; i++) {
          postProcessors.push(this.postProcessors[i].postProcessor);
        }
        return postProcessors;
      };
      PluginManager.prototype.getVisitors = function() {
        return this.visitors;
      };
      PluginManager.prototype.getFileManagers = function() {
        return this.fileManagers;
      };
      module.exports = PluginManager;
    }, {}],
    38: [function(require, module, exports) {
      var PromiseConstructor;
      module.exports = function(environment, ParseTree, ImportManager) {
        var render = function(input, options, callback) {
          if (typeof options === 'function') {
            callback = options;
            options = {};
          }
          if (!callback) {
            if (!PromiseConstructor) {
              PromiseConstructor = typeof Promise === 'undefined' ? require('promise') : Promise;
            }
            var self = this;
            return new PromiseConstructor(function(resolve, reject) {
              render.call(self, input, options, function(err, output) {
                if (err) {
                  reject(err);
                } else {
                  resolve(output);
                }
              });
            });
          } else {
            this.parse(input, options, function(err, root, imports, options) {
              if (err) {
                return callback(err);
              }
              var result;
              try {
                var parseTree = new ParseTree(root, imports);
                result = parseTree.toCSS(options);
              } catch (err) {
                return callback(err);
              }
              callback(null, result);
            });
          }
        };
        return render;
      };
    }, {"promise": undefined}],
    39: [function(require, module, exports) {
      module.exports = function(SourceMapOutput, environment) {
        var SourceMapBuilder = function(options) {
          this.options = options;
        };
        SourceMapBuilder.prototype.toCSS = function(rootNode, options, imports) {
          var sourceMapOutput = new SourceMapOutput({
            contentsIgnoredCharsMap: imports.contentsIgnoredChars,
            rootNode: rootNode,
            contentsMap: imports.contents,
            sourceMapFilename: this.options.sourceMapFilename,
            sourceMapURL: this.options.sourceMapURL,
            outputFilename: this.options.sourceMapOutputFilename,
            sourceMapBasepath: this.options.sourceMapBasepath,
            sourceMapRootpath: this.options.sourceMapRootpath,
            outputSourceFiles: this.options.outputSourceFiles,
            sourceMapGenerator: this.options.sourceMapGenerator,
            sourceMapFileInline: this.options.sourceMapFileInline
          });
          var css = sourceMapOutput.toCSS(options);
          this.sourceMap = sourceMapOutput.sourceMap;
          this.sourceMapURL = sourceMapOutput.sourceMapURL;
          if (this.options.sourceMapInputFilename) {
            this.sourceMapInputFilename = sourceMapOutput.normalizeFilename(this.options.sourceMapInputFilename);
          }
          return css + this.getCSSAppendage();
        };
        SourceMapBuilder.prototype.getCSSAppendage = function() {
          var sourceMapURL = this.sourceMapURL;
          if (this.options.sourceMapFileInline) {
            if (this.sourceMap === undefined) {
              return "";
            }
            sourceMapURL = "data:application/json;base64," + environment.encodeBase64(this.sourceMap);
          }
          if (sourceMapURL) {
            return "/*# sourceMappingURL=" + sourceMapURL + " */";
          }
          return "";
        };
        SourceMapBuilder.prototype.getExternalSourceMap = function() {
          return this.sourceMap;
        };
        SourceMapBuilder.prototype.setExternalSourceMap = function(sourceMap) {
          this.sourceMap = sourceMap;
        };
        SourceMapBuilder.prototype.isInline = function() {
          return this.options.sourceMapFileInline;
        };
        SourceMapBuilder.prototype.getSourceMapURL = function() {
          return this.sourceMapURL;
        };
        SourceMapBuilder.prototype.getOutputFilename = function() {
          return this.options.sourceMapOutputFilename;
        };
        SourceMapBuilder.prototype.getInputFilename = function() {
          return this.sourceMapInputFilename;
        };
        return SourceMapBuilder;
      };
    }, {}],
    40: [function(require, module, exports) {
      module.exports = function(environment) {
        var SourceMapOutput = function(options) {
          this._css = [];
          this._rootNode = options.rootNode;
          this._contentsMap = options.contentsMap;
          this._contentsIgnoredCharsMap = options.contentsIgnoredCharsMap;
          if (options.sourceMapFilename) {
            this._sourceMapFilename = options.sourceMapFilename.replace(/\\/g, '/');
          }
          this._outputFilename = options.outputFilename;
          this.sourceMapURL = options.sourceMapURL;
          if (options.sourceMapBasepath) {
            this._sourceMapBasepath = options.sourceMapBasepath.replace(/\\/g, '/');
          }
          if (options.sourceMapRootpath) {
            this._sourceMapRootpath = options.sourceMapRootpath.replace(/\\/g, '/');
            if (this._sourceMapRootpath.charAt(this._sourceMapRootpath.length - 1) !== '/') {
              this._sourceMapRootpath += '/';
            }
          } else {
            this._sourceMapRootpath = "";
          }
          this._outputSourceFiles = options.outputSourceFiles;
          this._sourceMapGeneratorConstructor = environment.getSourceMapGenerator();
          this._lineNumber = 0;
          this._column = 0;
        };
        SourceMapOutput.prototype.normalizeFilename = function(filename) {
          filename = filename.replace(/\\/g, '/');
          if (this._sourceMapBasepath && filename.indexOf(this._sourceMapBasepath) === 0) {
            filename = filename.substring(this._sourceMapBasepath.length);
            if (filename.charAt(0) === '\\' || filename.charAt(0) === '/') {
              filename = filename.substring(1);
            }
          }
          return (this._sourceMapRootpath || "") + filename;
        };
        SourceMapOutput.prototype.add = function(chunk, fileInfo, index, mapLines) {
          if (!chunk) {
            return ;
          }
          var lines,
              sourceLines,
              columns,
              sourceColumns,
              i;
          if (fileInfo) {
            var inputSource = this._contentsMap[fileInfo.filename];
            if (this._contentsIgnoredCharsMap[fileInfo.filename]) {
              index -= this._contentsIgnoredCharsMap[fileInfo.filename];
              if (index < 0) {
                index = 0;
              }
              inputSource = inputSource.slice(this._contentsIgnoredCharsMap[fileInfo.filename]);
            }
            inputSource = inputSource.substring(0, index);
            sourceLines = inputSource.split("\n");
            sourceColumns = sourceLines[sourceLines.length - 1];
          }
          lines = chunk.split("\n");
          columns = lines[lines.length - 1];
          if (fileInfo) {
            if (!mapLines) {
              this._sourceMapGenerator.addMapping({
                generated: {
                  line: this._lineNumber + 1,
                  column: this._column
                },
                original: {
                  line: sourceLines.length,
                  column: sourceColumns.length
                },
                source: this.normalizeFilename(fileInfo.filename)
              });
            } else {
              for (i = 0; i < lines.length; i++) {
                this._sourceMapGenerator.addMapping({
                  generated: {
                    line: this._lineNumber + i + 1,
                    column: i === 0 ? this._column : 0
                  },
                  original: {
                    line: sourceLines.length + i,
                    column: i === 0 ? sourceColumns.length : 0
                  },
                  source: this.normalizeFilename(fileInfo.filename)
                });
              }
            }
          }
          if (lines.length === 1) {
            this._column += columns.length;
          } else {
            this._lineNumber += lines.length - 1;
            this._column = columns.length;
          }
          this._css.push(chunk);
        };
        SourceMapOutput.prototype.isEmpty = function() {
          return this._css.length === 0;
        };
        SourceMapOutput.prototype.toCSS = function(context) {
          this._sourceMapGenerator = new this._sourceMapGeneratorConstructor({
            file: this._outputFilename,
            sourceRoot: null
          });
          if (this._outputSourceFiles) {
            for (var filename in this._contentsMap) {
              if (this._contentsMap.hasOwnProperty(filename)) {
                var source = this._contentsMap[filename];
                if (this._contentsIgnoredCharsMap[filename]) {
                  source = source.slice(this._contentsIgnoredCharsMap[filename]);
                }
                this._sourceMapGenerator.setSourceContent(this.normalizeFilename(filename), source);
              }
            }
          }
          this._rootNode.genCSS(context, this);
          if (this._css.length > 0) {
            var sourceMapURL,
                sourceMapContent = JSON.stringify(this._sourceMapGenerator.toJSON());
            if (this.sourceMapURL) {
              sourceMapURL = this.sourceMapURL;
            } else if (this._sourceMapFilename) {
              sourceMapURL = this._sourceMapFilename;
            }
            this.sourceMapURL = sourceMapURL;
            this.sourceMap = sourceMapContent;
          }
          return this._css.join('');
        };
        return SourceMapOutput;
      };
    }, {}],
    41: [function(require, module, exports) {
      var contexts = require("./contexts"),
          visitor = require("./visitors"),
          tree = require("./tree");
      module.exports = function(root, options) {
        options = options || {};
        var evaldRoot,
            variables = options.variables,
            evalEnv = new contexts.Eval(options);
        if (typeof variables === 'object' && !Array.isArray(variables)) {
          variables = Object.keys(variables).map(function(k) {
            var value = variables[k];
            if (!(value instanceof tree.Value)) {
              if (!(value instanceof tree.Expression)) {
                value = new tree.Expression([value]);
              }
              value = new tree.Value([value]);
            }
            return new tree.Rule('@' + k, value, false, null, 0);
          });
          evalEnv.frames = [new tree.Ruleset(null, variables)];
        }
        var preEvalVisitors = [],
            visitors = [new visitor.JoinSelectorVisitor(), new visitor.ExtendVisitor(), new visitor.ToCSSVisitor({compress: Boolean(options.compress)})],
            i;
        if (options.pluginManager) {
          var pluginVisitors = options.pluginManager.getVisitors();
          for (i = 0; i < pluginVisitors.length; i++) {
            var pluginVisitor = pluginVisitors[i];
            if (pluginVisitor.isPreEvalVisitor) {
              preEvalVisitors.push(pluginVisitor);
            } else {
              if (pluginVisitor.isPreVisitor) {
                visitors.splice(0, 0, pluginVisitor);
              } else {
                visitors.push(pluginVisitor);
              }
            }
          }
        }
        for (i = 0; i < preEvalVisitors.length; i++) {
          preEvalVisitors[i].run(root);
        }
        evaldRoot = root.eval(evalEnv);
        for (i = 0; i < visitors.length; i++) {
          visitors[i].run(evaldRoot);
        }
        return evaldRoot;
      };
    }, {
      "./contexts": 10,
      "./tree": 59,
      "./visitors": 84
    }],
    42: [function(require, module, exports) {
      var Node = require("./node");
      var Alpha = function(val) {
        this.value = val;
      };
      Alpha.prototype = new Node();
      Alpha.prototype.type = "Alpha";
      Alpha.prototype.accept = function(visitor) {
        this.value = visitor.visit(this.value);
      };
      Alpha.prototype.eval = function(context) {
        if (this.value.eval) {
          return new Alpha(this.value.eval(context));
        }
        return this;
      };
      Alpha.prototype.genCSS = function(context, output) {
        output.add("alpha(opacity=");
        if (this.value.genCSS) {
          this.value.genCSS(context, output);
        } else {
          output.add(this.value);
        }
        output.add(")");
      };
      module.exports = Alpha;
    }, {"./node": 67}],
    43: [function(require, module, exports) {
      var Node = require("./node");
      var Anonymous = function(value, index, currentFileInfo, mapLines, rulesetLike) {
        this.value = value;
        this.index = index;
        this.mapLines = mapLines;
        this.currentFileInfo = currentFileInfo;
        this.rulesetLike = (typeof rulesetLike === 'undefined') ? false : rulesetLike;
      };
      Anonymous.prototype = new Node();
      Anonymous.prototype.type = "Anonymous";
      Anonymous.prototype.eval = function() {
        return new Anonymous(this.value, this.index, this.currentFileInfo, this.mapLines, this.rulesetLike);
      };
      Anonymous.prototype.compare = function(other) {
        return other.toCSS && this.toCSS() === other.toCSS() ? 0 : undefined;
      };
      Anonymous.prototype.isRulesetLike = function() {
        return this.rulesetLike;
      };
      Anonymous.prototype.genCSS = function(context, output) {
        output.add(this.value, this.currentFileInfo, this.index, this.mapLines);
      };
      module.exports = Anonymous;
    }, {"./node": 67}],
    44: [function(require, module, exports) {
      var Node = require("./node");
      var Assignment = function(key, val) {
        this.key = key;
        this.value = val;
      };
      Assignment.prototype = new Node();
      Assignment.prototype.type = "Assignment";
      Assignment.prototype.accept = function(visitor) {
        this.value = visitor.visit(this.value);
      };
      Assignment.prototype.eval = function(context) {
        if (this.value.eval) {
          return new Assignment(this.key, this.value.eval(context));
        }
        return this;
      };
      Assignment.prototype.genCSS = function(context, output) {
        output.add(this.key + '=');
        if (this.value.genCSS) {
          this.value.genCSS(context, output);
        } else {
          output.add(this.value);
        }
      };
      module.exports = Assignment;
    }, {"./node": 67}],
    45: [function(require, module, exports) {
      var Node = require("./node");
      var Attribute = function(key, op, value) {
        this.key = key;
        this.op = op;
        this.value = value;
      };
      Attribute.prototype = new Node();
      Attribute.prototype.type = "Attribute";
      Attribute.prototype.eval = function(context) {
        return new Attribute(this.key.eval ? this.key.eval(context) : this.key, this.op, (this.value && this.value.eval) ? this.value.eval(context) : this.value);
      };
      Attribute.prototype.genCSS = function(context, output) {
        output.add(this.toCSS(context));
      };
      Attribute.prototype.toCSS = function(context) {
        var value = this.key.toCSS ? this.key.toCSS(context) : this.key;
        if (this.op) {
          value += this.op;
          value += (this.value.toCSS ? this.value.toCSS(context) : this.value);
        }
        return '[' + value + ']';
      };
      module.exports = Attribute;
    }, {"./node": 67}],
    46: [function(require, module, exports) {
      var Node = require("./node"),
          FunctionCaller = require("../functions/function-caller");
      var Call = function(name, args, index, currentFileInfo) {
        this.name = name;
        this.args = args;
        this.index = index;
        this.currentFileInfo = currentFileInfo;
      };
      Call.prototype = new Node();
      Call.prototype.type = "Call";
      Call.prototype.accept = function(visitor) {
        if (this.args) {
          this.args = visitor.visitArray(this.args);
        }
      };
      Call.prototype.eval = function(context) {
        var args = this.args.map(function(a) {
          return a.eval(context);
        }),
            result,
            funcCaller = new FunctionCaller(this.name, context, this.index, this.currentFileInfo);
        if (funcCaller.isValid()) {
          try {
            result = funcCaller.call(args);
            if (result != null) {
              return result;
            }
          } catch (e) {
            throw {
              type: e.type || "Runtime",
              message: "error evaluating function `" + this.name + "`" + (e.message ? ': ' + e.message : ''),
              index: this.index,
              filename: this.currentFileInfo.filename
            };
          }
        }
        return new Call(this.name, args, this.index, this.currentFileInfo);
      };
      Call.prototype.genCSS = function(context, output) {
        output.add(this.name + "(", this.currentFileInfo, this.index);
        for (var i = 0; i < this.args.length; i++) {
          this.args[i].genCSS(context, output);
          if (i + 1 < this.args.length) {
            output.add(", ");
          }
        }
        output.add(")");
      };
      module.exports = Call;
    }, {
      "../functions/function-caller": 20,
      "./node": 67
    }],
    47: [function(require, module, exports) {
      var Node = require("./node"),
          colors = require("../data/colors");
      var Color = function(rgb, a) {
        if (Array.isArray(rgb)) {
          this.rgb = rgb;
        } else if (rgb.length == 6) {
          this.rgb = rgb.match(/.{2}/g).map(function(c) {
            return parseInt(c, 16);
          });
        } else {
          this.rgb = rgb.split('').map(function(c) {
            return parseInt(c + c, 16);
          });
        }
        this.alpha = typeof a === 'number' ? a : 1;
      };
      Color.prototype = new Node();
      Color.prototype.type = "Color";
      function clamp(v, max) {
        return Math.min(Math.max(v, 0), max);
      }
      function toHex(v) {
        return '#' + v.map(function(c) {
          c = clamp(Math.round(c), 255);
          return (c < 16 ? '0' : '') + c.toString(16);
        }).join('');
      }
      Color.prototype.luma = function() {
        var r = this.rgb[0] / 255,
            g = this.rgb[1] / 255,
            b = this.rgb[2] / 255;
        r = (r <= 0.03928) ? r / 12.92 : Math.pow(((r + 0.055) / 1.055), 2.4);
        g = (g <= 0.03928) ? g / 12.92 : Math.pow(((g + 0.055) / 1.055), 2.4);
        b = (b <= 0.03928) ? b / 12.92 : Math.pow(((b + 0.055) / 1.055), 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      Color.prototype.genCSS = function(context, output) {
        output.add(this.toCSS(context));
      };
      Color.prototype.toCSS = function(context, doNotCompress) {
        var compress = context && context.compress && !doNotCompress,
            color,
            alpha;
        if (this.value) {
          return this.value;
        }
        alpha = this.fround(context, this.alpha);
        if (alpha < 1) {
          return "rgba(" + this.rgb.map(function(c) {
            return clamp(Math.round(c), 255);
          }).concat(clamp(alpha, 1)).join(',' + (compress ? '' : ' ')) + ")";
        }
        color = this.toRGB();
        if (compress) {
          var splitcolor = color.split('');
          if (splitcolor[1] === splitcolor[2] && splitcolor[3] === splitcolor[4] && splitcolor[5] === splitcolor[6]) {
            color = '#' + splitcolor[1] + splitcolor[3] + splitcolor[5];
          }
        }
        return color;
      };
      Color.prototype.operate = function(context, op, other) {
        var rgb = [];
        var alpha = this.alpha * (1 - other.alpha) + other.alpha;
        for (var c = 0; c < 3; c++) {
          rgb[c] = this._operate(context, op, this.rgb[c], other.rgb[c]);
        }
        return new Color(rgb, alpha);
      };
      Color.prototype.toRGB = function() {
        return toHex(this.rgb);
      };
      Color.prototype.toHSL = function() {
        var r = this.rgb[0] / 255,
            g = this.rgb[1] / 255,
            b = this.rgb[2] / 255,
            a = this.alpha;
        var max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        var h,
            s,
            l = (max + min) / 2,
            d = max - min;
        if (max === min) {
          h = s = 0;
        } else {
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r:
              h = (g - b) / d + (g < b ? 6 : 0);
              break;
            case g:
              h = (b - r) / d + 2;
              break;
            case b:
              h = (r - g) / d + 4;
              break;
          }
          h /= 6;
        }
        return {
          h: h * 360,
          s: s,
          l: l,
          a: a
        };
      };
      Color.prototype.toHSV = function() {
        var r = this.rgb[0] / 255,
            g = this.rgb[1] / 255,
            b = this.rgb[2] / 255,
            a = this.alpha;
        var max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        var h,
            s,
            v = max;
        var d = max - min;
        if (max === 0) {
          s = 0;
        } else {
          s = d / max;
        }
        if (max === min) {
          h = 0;
        } else {
          switch (max) {
            case r:
              h = (g - b) / d + (g < b ? 6 : 0);
              break;
            case g:
              h = (b - r) / d + 2;
              break;
            case b:
              h = (r - g) / d + 4;
              break;
          }
          h /= 6;
        }
        return {
          h: h * 360,
          s: s,
          v: v,
          a: a
        };
      };
      Color.prototype.toARGB = function() {
        return toHex([this.alpha * 255].concat(this.rgb));
      };
      Color.prototype.compare = function(x) {
        return (x.rgb && x.rgb[0] === this.rgb[0] && x.rgb[1] === this.rgb[1] && x.rgb[2] === this.rgb[2] && x.alpha === this.alpha) ? 0 : undefined;
      };
      Color.fromKeyword = function(keyword) {
        var c,
            key = keyword.toLowerCase();
        if (colors.hasOwnProperty(key)) {
          c = new Color(colors[key].slice(1));
        } else if (key === "transparent") {
          c = new Color([0, 0, 0], 0);
        }
        if (c) {
          c.value = keyword;
          return c;
        }
      };
      module.exports = Color;
    }, {
      "../data/colors": 11,
      "./node": 67
    }],
    48: [function(require, module, exports) {
      var Node = require("./node");
      var Combinator = function(value) {
        if (value === ' ') {
          this.value = ' ';
          this.emptyOrWhitespace = true;
        } else {
          this.value = value ? value.trim() : "";
          this.emptyOrWhitespace = this.value === "";
        }
      };
      Combinator.prototype = new Node();
      Combinator.prototype.type = "Combinator";
      var _noSpaceCombinators = {
        '': true,
        ' ': true,
        '|': true
      };
      Combinator.prototype.genCSS = function(context, output) {
        var spaceOrEmpty = (context.compress || _noSpaceCombinators[this.value]) ? '' : ' ';
        output.add(spaceOrEmpty + this.value + spaceOrEmpty);
      };
      module.exports = Combinator;
    }, {"./node": 67}],
    49: [function(require, module, exports) {
      var Node = require("./node"),
          getDebugInfo = require("./debug-info");
      var Comment = function(value, isLineComment, index, currentFileInfo) {
        this.value = value;
        this.isLineComment = isLineComment;
        this.currentFileInfo = currentFileInfo;
      };
      Comment.prototype = new Node();
      Comment.prototype.type = "Comment";
      Comment.prototype.genCSS = function(context, output) {
        if (this.debugInfo) {
          output.add(getDebugInfo(context, this), this.currentFileInfo, this.index);
        }
        output.add(this.value);
      };
      Comment.prototype.isSilent = function(context) {
        var isReference = (this.currentFileInfo && this.currentFileInfo.reference && !this.isReferenced),
            isCompressed = context.compress && this.value[2] !== "!";
        return this.isLineComment || isReference || isCompressed;
      };
      Comment.prototype.markReferenced = function() {
        this.isReferenced = true;
      };
      Comment.prototype.isRulesetLike = function(root) {
        return Boolean(root);
      };
      module.exports = Comment;
    }, {
      "./debug-info": 51,
      "./node": 67
    }],
    50: [function(require, module, exports) {
      var Node = require("./node");
      var Condition = function(op, l, r, i, negate) {
        this.op = op.trim();
        this.lvalue = l;
        this.rvalue = r;
        this.index = i;
        this.negate = negate;
      };
      Condition.prototype = new Node();
      Condition.prototype.type = "Condition";
      Condition.prototype.accept = function(visitor) {
        this.lvalue = visitor.visit(this.lvalue);
        this.rvalue = visitor.visit(this.rvalue);
      };
      Condition.prototype.eval = function(context) {
        var result = (function(op, a, b) {
          switch (op) {
            case 'and':
              return a && b;
            case 'or':
              return a || b;
            default:
              switch (Node.compare(a, b)) {
                case -1:
                  return op === '<' || op === '=<' || op === '<=';
                case 0:
                  return op === '=' || op === '>=' || op === '=<' || op === '<=';
                case 1:
                  return op === '>' || op === '>=';
                default:
                  return false;
              }
          }
        })(this.op, this.lvalue.eval(context), this.rvalue.eval(context));
        return this.negate ? !result : result;
      };
      module.exports = Condition;
    }, {"./node": 67}],
    51: [function(require, module, exports) {
      var debugInfo = function(context, ctx, lineSeparator) {
        var result = "";
        if (context.dumpLineNumbers && !context.compress) {
          switch (context.dumpLineNumbers) {
            case 'comments':
              result = debugInfo.asComment(ctx);
              break;
            case 'mediaquery':
              result = debugInfo.asMediaQuery(ctx);
              break;
            case 'all':
              result = debugInfo.asComment(ctx) + (lineSeparator || "") + debugInfo.asMediaQuery(ctx);
              break;
          }
        }
        return result;
      };
      debugInfo.asComment = function(ctx) {
        return '/* line ' + ctx.debugInfo.lineNumber + ', ' + ctx.debugInfo.fileName + ' */\n';
      };
      debugInfo.asMediaQuery = function(ctx) {
        var filenameWithProtocol = ctx.debugInfo.fileName;
        if (!/^[a-z]+:\/\//i.test(filenameWithProtocol)) {
          filenameWithProtocol = 'file://' + filenameWithProtocol;
        }
        return '@media -sass-debug-info{filename{font-family:' + filenameWithProtocol.replace(/([.:\/\\])/g, function(a) {
          if (a == '\\') {
            a = '\/';
          }
          return '\\' + a;
        }) + '}line{font-family:\\00003' + ctx.debugInfo.lineNumber + '}}\n';
      };
      module.exports = debugInfo;
    }, {}],
    52: [function(require, module, exports) {
      var Node = require("./node"),
          contexts = require("../contexts");
      var DetachedRuleset = function(ruleset, frames) {
        this.ruleset = ruleset;
        this.frames = frames;
      };
      DetachedRuleset.prototype = new Node();
      DetachedRuleset.prototype.type = "DetachedRuleset";
      DetachedRuleset.prototype.evalFirst = true;
      DetachedRuleset.prototype.accept = function(visitor) {
        this.ruleset = visitor.visit(this.ruleset);
      };
      DetachedRuleset.prototype.eval = function(context) {
        var frames = this.frames || context.frames.slice(0);
        return new DetachedRuleset(this.ruleset, frames);
      };
      DetachedRuleset.prototype.callEval = function(context) {
        return this.ruleset.eval(this.frames ? new contexts.Eval(context, this.frames.concat(context.frames)) : context);
      };
      module.exports = DetachedRuleset;
    }, {
      "../contexts": 10,
      "./node": 67
    }],
    53: [function(require, module, exports) {
      var Node = require("./node"),
          unitConversions = require("../data/unit-conversions"),
          Unit = require("./unit"),
          Color = require("./color");
      var Dimension = function(value, unit) {
        this.value = parseFloat(value);
        this.unit = (unit && unit instanceof Unit) ? unit : new Unit(unit ? [unit] : undefined);
      };
      Dimension.prototype = new Node();
      Dimension.prototype.type = "Dimension";
      Dimension.prototype.accept = function(visitor) {
        this.unit = visitor.visit(this.unit);
      };
      Dimension.prototype.eval = function(context) {
        return this;
      };
      Dimension.prototype.toColor = function() {
        return new Color([this.value, this.value, this.value]);
      };
      Dimension.prototype.genCSS = function(context, output) {
        if ((context && context.strictUnits) && !this.unit.isSingular()) {
          throw new Error("Multiple units in dimension. Correct the units or use the unit function. Bad unit: " + this.unit.toString());
        }
        var value = this.fround(context, this.value),
            strValue = String(value);
        if (value !== 0 && value < 0.000001 && value > -0.000001) {
          strValue = value.toFixed(20).replace(/0+$/, "");
        }
        if (context && context.compress) {
          if (value === 0 && this.unit.isLength()) {
            output.add(strValue);
            return ;
          }
          if (value > 0 && value < 1) {
            strValue = (strValue).substr(1);
          }
        }
        output.add(strValue);
        this.unit.genCSS(context, output);
      };
      Dimension.prototype.operate = function(context, op, other) {
        var value = this._operate(context, op, this.value, other.value),
            unit = this.unit.clone();
        if (op === '+' || op === '-') {
          if (unit.numerator.length === 0 && unit.denominator.length === 0) {
            unit.numerator = other.unit.numerator.slice(0);
            unit.denominator = other.unit.denominator.slice(0);
          } else if (other.unit.numerator.length === 0 && unit.denominator.length === 0) {} else {
            other = other.convertTo(this.unit.usedUnits());
            if (context.strictUnits && other.unit.toString() !== unit.toString()) {
              throw new Error("Incompatible units. Change the units or use the unit function. Bad units: '" + unit.toString() + "' and '" + other.unit.toString() + "'.");
            }
            value = this._operate(context, op, this.value, other.value);
          }
        } else if (op === '*') {
          unit.numerator = unit.numerator.concat(other.unit.numerator).sort();
          unit.denominator = unit.denominator.concat(other.unit.denominator).sort();
          unit.cancel();
        } else if (op === '/') {
          unit.numerator = unit.numerator.concat(other.unit.denominator).sort();
          unit.denominator = unit.denominator.concat(other.unit.numerator).sort();
          unit.cancel();
        }
        return new Dimension(value, unit);
      };
      Dimension.prototype.compare = function(other) {
        var a,
            b;
        if (!(other instanceof Dimension)) {
          return undefined;
        }
        if (this.unit.isEmpty() || other.unit.isEmpty()) {
          a = this;
          b = other;
        } else {
          a = this.unify();
          b = other.unify();
          if (a.unit.compare(b.unit) !== 0) {
            return undefined;
          }
        }
        return Node.numericCompare(a.value, b.value);
      };
      Dimension.prototype.unify = function() {
        return this.convertTo({
          length: 'px',
          duration: 's',
          angle: 'rad'
        });
      };
      Dimension.prototype.convertTo = function(conversions) {
        var value = this.value,
            unit = this.unit.clone(),
            i,
            groupName,
            group,
            targetUnit,
            derivedConversions = {},
            applyUnit;
        if (typeof conversions === 'string') {
          for (i in unitConversions) {
            if (unitConversions[i].hasOwnProperty(conversions)) {
              derivedConversions = {};
              derivedConversions[i] = conversions;
            }
          }
          conversions = derivedConversions;
        }
        applyUnit = function(atomicUnit, denominator) {
          if (group.hasOwnProperty(atomicUnit)) {
            if (denominator) {
              value = value / (group[atomicUnit] / group[targetUnit]);
            } else {
              value = value * (group[atomicUnit] / group[targetUnit]);
            }
            return targetUnit;
          }
          return atomicUnit;
        };
        for (groupName in conversions) {
          if (conversions.hasOwnProperty(groupName)) {
            targetUnit = conversions[groupName];
            group = unitConversions[groupName];
            unit.map(applyUnit);
          }
        }
        unit.cancel();
        return new Dimension(value, unit);
      };
      module.exports = Dimension;
    }, {
      "../data/unit-conversions": 13,
      "./color": 47,
      "./node": 67,
      "./unit": 76
    }],
    54: [function(require, module, exports) {
      var Node = require("./node"),
          Ruleset = require("./ruleset");
      var Directive = function(name, value, rules, index, currentFileInfo, debugInfo, isReferenced) {
        this.name = name;
        this.value = value;
        if (rules) {
          this.rules = rules;
          this.rules.allowImports = true;
        }
        this.index = index;
        this.currentFileInfo = currentFileInfo;
        this.debugInfo = debugInfo;
        this.isReferenced = isReferenced;
      };
      Directive.prototype = new Node();
      Directive.prototype.type = "Directive";
      Directive.prototype.accept = function(visitor) {
        var value = this.value,
            rules = this.rules;
        if (rules) {
          this.rules = visitor.visit(rules);
        }
        if (value) {
          this.value = visitor.visit(value);
        }
      };
      Directive.prototype.isRulesetLike = function() {
        return this.rules || !this.isCharset();
      };
      Directive.prototype.isCharset = function() {
        return "@charset" === this.name;
      };
      Directive.prototype.genCSS = function(context, output) {
        var value = this.value,
            rules = this.rules;
        output.add(this.name, this.currentFileInfo, this.index);
        if (value) {
          output.add(' ');
          value.genCSS(context, output);
        }
        if (rules) {
          if (rules.type === "Ruleset") {
            rules = [rules];
          }
          this.outputRuleset(context, output, rules);
        } else {
          output.add(';');
        }
      };
      Directive.prototype.eval = function(context) {
        var value = this.value,
            rules = this.rules;
        if (value) {
          value = value.eval(context);
        }
        if (rules) {
          rules = rules.eval(context);
          rules.root = true;
        }
        return new Directive(this.name, value, rules, this.index, this.currentFileInfo, this.debugInfo, this.isReferenced);
      };
      Directive.prototype.variable = function(name) {
        if (this.rules) {
          return Ruleset.prototype.variable.call(this.rules, name);
        }
      };
      Directive.prototype.find = function() {
        if (this.rules) {
          return Ruleset.prototype.find.apply(this.rules, arguments);
        }
      };
      Directive.prototype.rulesets = function() {
        if (this.rules) {
          return Ruleset.prototype.rulesets.apply(this.rules);
        }
      };
      Directive.prototype.markReferenced = function() {
        var i,
            rules;
        this.isReferenced = true;
        if (this.rules) {
          rules = this.rules.rules;
          for (i = 0; i < rules.length; i++) {
            if (rules[i].markReferenced) {
              rules[i].markReferenced();
            }
          }
        }
      };
      Directive.prototype.getIsReferenced = function() {
        return !this.currentFileInfo || !this.currentFileInfo.reference || this.isReferenced;
      };
      Directive.prototype.outputRuleset = function(context, output, rules) {
        var ruleCnt = rules.length,
            i;
        context.tabLevel = (context.tabLevel | 0) + 1;
        if (context.compress) {
          output.add('{');
          for (i = 0; i < ruleCnt; i++) {
            rules[i].genCSS(context, output);
          }
          output.add('}');
          context.tabLevel--;
          return ;
        }
        var tabSetStr = '\n' + Array(context.tabLevel).join("  "),
            tabRuleStr = tabSetStr + "  ";
        if (!ruleCnt) {
          output.add(" {" + tabSetStr + '}');
        } else {
          output.add(" {" + tabRuleStr);
          rules[0].genCSS(context, output);
          for (i = 1; i < ruleCnt; i++) {
            output.add(tabRuleStr);
            rules[i].genCSS(context, output);
          }
          output.add(tabSetStr + '}');
        }
        context.tabLevel--;
      };
      module.exports = Directive;
    }, {
      "./node": 67,
      "./ruleset": 73
    }],
    55: [function(require, module, exports) {
      var Node = require("./node"),
          Paren = require("./paren"),
          Combinator = require("./combinator");
      var Element = function(combinator, value, index, currentFileInfo) {
        this.combinator = combinator instanceof Combinator ? combinator : new Combinator(combinator);
        if (typeof value === 'string') {
          this.value = value.trim();
        } else if (value) {
          this.value = value;
        } else {
          this.value = "";
        }
        this.index = index;
        this.currentFileInfo = currentFileInfo;
      };
      Element.prototype = new Node();
      Element.prototype.type = "Element";
      Element.prototype.accept = function(visitor) {
        var value = this.value;
        this.combinator = visitor.visit(this.combinator);
        if (typeof value === "object") {
          this.value = visitor.visit(value);
        }
      };
      Element.prototype.eval = function(context) {
        return new Element(this.combinator, this.value.eval ? this.value.eval(context) : this.value, this.index, this.currentFileInfo);
      };
      Element.prototype.genCSS = function(context, output) {
        output.add(this.toCSS(context), this.currentFileInfo, this.index);
      };
      Element.prototype.toCSS = function(context) {
        context = context || {};
        var value = this.value,
            firstSelector = context.firstSelector;
        if (value instanceof Paren) {
          context.firstSelector = true;
        }
        value = value.toCSS ? value.toCSS(context) : value;
        context.firstSelector = firstSelector;
        if (value === '' && this.combinator.value.charAt(0) === '&') {
          return '';
        } else {
          return this.combinator.toCSS(context) + value;
        }
      };
      module.exports = Element;
    }, {
      "./combinator": 48,
      "./node": 67,
      "./paren": 69
    }],
    56: [function(require, module, exports) {
      var Node = require("./node"),
          Paren = require("./paren"),
          Comment = require("./comment");
      var Expression = function(value) {
        this.value = value;
        if (!value) {
          throw new Error("Expression requires an array parameter");
        }
      };
      Expression.prototype = new Node();
      Expression.prototype.type = "Expression";
      Expression.prototype.accept = function(visitor) {
        this.value = visitor.visitArray(this.value);
      };
      Expression.prototype.eval = function(context) {
        var returnValue,
            inParenthesis = this.parens && !this.parensInOp,
            doubleParen = false;
        if (inParenthesis) {
          context.inParenthesis();
        }
        if (this.value.length > 1) {
          returnValue = new Expression(this.value.map(function(e) {
            return e.eval(context);
          }));
        } else if (this.value.length === 1) {
          if (this.value[0].parens && !this.value[0].parensInOp) {
            doubleParen = true;
          }
          returnValue = this.value[0].eval(context);
        } else {
          returnValue = this;
        }
        if (inParenthesis) {
          context.outOfParenthesis();
        }
        if (this.parens && this.parensInOp && !(context.isMathOn()) && !doubleParen) {
          returnValue = new Paren(returnValue);
        }
        return returnValue;
      };
      Expression.prototype.genCSS = function(context, output) {
        for (var i = 0; i < this.value.length; i++) {
          this.value[i].genCSS(context, output);
          if (i + 1 < this.value.length) {
            output.add(" ");
          }
        }
      };
      Expression.prototype.throwAwayComments = function() {
        this.value = this.value.filter(function(v) {
          return !(v instanceof Comment);
        });
      };
      module.exports = Expression;
    }, {
      "./comment": 49,
      "./node": 67,
      "./paren": 69
    }],
    57: [function(require, module, exports) {
      var Node = require("./node");
      var Extend = function Extend(selector, option, index) {
        this.selector = selector;
        this.option = option;
        this.index = index;
        this.object_id = Extend.next_id++;
        this.parent_ids = [this.object_id];
        switch (option) {
          case "all":
            this.allowBefore = true;
            this.allowAfter = true;
            break;
          default:
            this.allowBefore = false;
            this.allowAfter = false;
            break;
        }
      };
      Extend.next_id = 0;
      Extend.prototype = new Node();
      Extend.prototype.type = "Extend";
      Extend.prototype.accept = function(visitor) {
        this.selector = visitor.visit(this.selector);
      };
      Extend.prototype.eval = function(context) {
        return new Extend(this.selector.eval(context), this.option, this.index);
      };
      Extend.prototype.clone = function(context) {
        return new Extend(this.selector, this.option, this.index);
      };
      Extend.prototype.findSelfSelectors = function(selectors) {
        var selfElements = [],
            i,
            selectorElements;
        for (i = 0; i < selectors.length; i++) {
          selectorElements = selectors[i].elements;
          if (i > 0 && selectorElements.length && selectorElements[0].combinator.value === "") {
            selectorElements[0].combinator.value = ' ';
          }
          selfElements = selfElements.concat(selectors[i].elements);
        }
        this.selfSelectors = [{elements: selfElements}];
      };
      module.exports = Extend;
    }, {"./node": 67}],
    58: [function(require, module, exports) {
      var Node = require("./node"),
          Media = require("./media"),
          URL = require("./url"),
          Quoted = require("./quoted"),
          Ruleset = require("./ruleset"),
          Anonymous = require("./anonymous");
      var Import = function(path, features, options, index, currentFileInfo) {
        this.options = options;
        this.index = index;
        this.path = path;
        this.features = features;
        this.currentFileInfo = currentFileInfo;
        if (this.options.less !== undefined || this.options.inline) {
          this.css = !this.options.less || this.options.inline;
        } else {
          var pathValue = this.getPath();
          if (pathValue && /[#\.\&\?\/]css([\?;].*)?$/.test(pathValue)) {
            this.css = true;
          }
        }
      };
      Import.prototype = new Node();
      Import.prototype.type = "Import";
      Import.prototype.accept = function(visitor) {
        if (this.features) {
          this.features = visitor.visit(this.features);
        }
        this.path = visitor.visit(this.path);
        if (!this.options.inline && this.root) {
          this.root = visitor.visit(this.root);
        }
      };
      Import.prototype.genCSS = function(context, output) {
        if (this.css) {
          output.add("@import ", this.currentFileInfo, this.index);
          this.path.genCSS(context, output);
          if (this.features) {
            output.add(" ");
            this.features.genCSS(context, output);
          }
          output.add(';');
        }
      };
      Import.prototype.getPath = function() {
        if (this.path instanceof Quoted) {
          return this.path.value;
        } else if (this.path instanceof URL) {
          return this.path.value.value;
        }
        return null;
      };
      Import.prototype.isVariableImport = function() {
        var path = this.path;
        if (path instanceof URL) {
          path = path.value;
        }
        if (path instanceof Quoted) {
          return path.containsVariables();
        }
        return true;
      };
      Import.prototype.evalForImport = function(context) {
        var path = this.path;
        if (path instanceof URL) {
          path = path.value;
        }
        return new Import(path.eval(context), this.features, this.options, this.index, this.currentFileInfo);
      };
      Import.prototype.evalPath = function(context) {
        var path = this.path.eval(context);
        var rootpath = this.currentFileInfo && this.currentFileInfo.rootpath;
        if (!(path instanceof URL)) {
          if (rootpath) {
            var pathValue = path.value;
            if (pathValue && context.isPathRelative(pathValue)) {
              path.value = rootpath + pathValue;
            }
          }
          path.value = context.normalizePath(path.value);
        }
        return path;
      };
      Import.prototype.eval = function(context) {
        var ruleset,
            features = this.features && this.features.eval(context);
        if (this.skip) {
          if (typeof this.skip === "function") {
            this.skip = this.skip();
          }
          if (this.skip) {
            return [];
          }
        }
        if (this.options.inline) {
          var contents = new Anonymous(this.root, 0, {filename: this.importedFilename}, true, true);
          return this.features ? new Media([contents], this.features.value) : [contents];
        } else if (this.css) {
          var newImport = new Import(this.evalPath(context), features, this.options, this.index);
          if (!newImport.css && this.error) {
            throw this.error;
          }
          return newImport;
        } else {
          ruleset = new Ruleset(null, this.root.rules.slice(0));
          ruleset.evalImports(context);
          return this.features ? new Media(ruleset.rules, this.features.value) : ruleset.rules;
        }
      };
      module.exports = Import;
    }, {
      "./anonymous": 43,
      "./media": 63,
      "./node": 67,
      "./quoted": 70,
      "./ruleset": 73,
      "./url": 77
    }],
    59: [function(require, module, exports) {
      var tree = {};
      tree.Node = require('./node');
      tree.Alpha = require('./alpha');
      tree.Color = require('./color');
      tree.Directive = require('./directive');
      tree.DetachedRuleset = require('./detached-ruleset');
      tree.Operation = require('./operation');
      tree.Dimension = require('./dimension');
      tree.Unit = require('./unit');
      tree.Keyword = require('./keyword');
      tree.Variable = require('./variable');
      tree.Ruleset = require('./ruleset');
      tree.Element = require('./element');
      tree.Attribute = require('./attribute');
      tree.Combinator = require('./combinator');
      tree.Selector = require('./selector');
      tree.Quoted = require('./quoted');
      tree.Expression = require('./expression');
      tree.Rule = require('./rule');
      tree.Call = require('./call');
      tree.URL = require('./url');
      tree.Import = require('./import');
      tree.mixin = {
        Call: require('./mixin-call'),
        Definition: require('./mixin-definition')
      };
      tree.Comment = require('./comment');
      tree.Anonymous = require('./anonymous');
      tree.Value = require('./value');
      tree.JavaScript = require('./javascript');
      tree.Assignment = require('./assignment');
      tree.Condition = require('./condition');
      tree.Paren = require('./paren');
      tree.Media = require('./media');
      tree.UnicodeDescriptor = require('./unicode-descriptor');
      tree.Negative = require('./negative');
      tree.Extend = require('./extend');
      tree.RulesetCall = require('./ruleset-call');
      module.exports = tree;
    }, {
      "./alpha": 42,
      "./anonymous": 43,
      "./assignment": 44,
      "./attribute": 45,
      "./call": 46,
      "./color": 47,
      "./combinator": 48,
      "./comment": 49,
      "./condition": 50,
      "./detached-ruleset": 52,
      "./dimension": 53,
      "./directive": 54,
      "./element": 55,
      "./expression": 56,
      "./extend": 57,
      "./import": 58,
      "./javascript": 60,
      "./keyword": 62,
      "./media": 63,
      "./mixin-call": 64,
      "./mixin-definition": 65,
      "./negative": 66,
      "./node": 67,
      "./operation": 68,
      "./paren": 69,
      "./quoted": 70,
      "./rule": 71,
      "./ruleset": 73,
      "./ruleset-call": 72,
      "./selector": 74,
      "./unicode-descriptor": 75,
      "./unit": 76,
      "./url": 77,
      "./value": 78,
      "./variable": 79
    }],
    60: [function(require, module, exports) {
      var JsEvalNode = require("./js-eval-node"),
          Dimension = require("./dimension"),
          Quoted = require("./quoted"),
          Anonymous = require("./anonymous");
      var JavaScript = function(string, escaped, index, currentFileInfo) {
        this.escaped = escaped;
        this.expression = string;
        this.index = index;
        this.currentFileInfo = currentFileInfo;
      };
      JavaScript.prototype = new JsEvalNode();
      JavaScript.prototype.type = "JavaScript";
      JavaScript.prototype.eval = function(context) {
        var result = this.evaluateJavaScript(this.expression, context);
        if (typeof result === 'number') {
          return new Dimension(result);
        } else if (typeof result === 'string') {
          return new Quoted('"' + result + '"', result, this.escaped, this.index);
        } else if (Array.isArray(result)) {
          return new Anonymous(result.join(', '));
        } else {
          return new Anonymous(result);
        }
      };
      module.exports = JavaScript;
    }, {
      "./anonymous": 43,
      "./dimension": 53,
      "./js-eval-node": 61,
      "./quoted": 70
    }],
    61: [function(require, module, exports) {
      var Node = require("./node"),
          Variable = require("./variable");
      var JsEvalNode = function() {};
      JsEvalNode.prototype = new Node();
      JsEvalNode.prototype.evaluateJavaScript = function(expression, context) {
        var result,
            that = this,
            evalContext = {};
        if (context.javascriptEnabled !== undefined && !context.javascriptEnabled) {
          throw {
            message: "You are using JavaScript, which has been disabled.",
            filename: this.currentFileInfo.filename,
            index: this.index
          };
        }
        expression = expression.replace(/@\{([\w-]+)\}/g, function(_, name) {
          return that.jsify(new Variable('@' + name, that.index, that.currentFileInfo).eval(context));
        });
        try {
          expression = new Function('return (' + expression + ')');
        } catch (e) {
          throw {
            message: "JavaScript evaluation error: " + e.message + " from `" + expression + "`",
            filename: this.currentFileInfo.filename,
            index: this.index
          };
        }
        var variables = context.frames[0].variables();
        for (var k in variables) {
          if (variables.hasOwnProperty(k)) {
            evalContext[k.slice(1)] = {
              value: variables[k].value,
              toJS: function() {
                return this.value.eval(context).toCSS();
              }
            };
          }
        }
        try {
          result = expression.call(evalContext);
        } catch (e) {
          throw {
            message: "JavaScript evaluation error: '" + e.name + ': ' + e.message.replace(/["]/g, "'") + "'",
            filename: this.currentFileInfo.filename,
            index: this.index
          };
        }
        return result;
      };
      JsEvalNode.prototype.jsify = function(obj) {
        if (Array.isArray(obj.value) && (obj.value.length > 1)) {
          return '[' + obj.value.map(function(v) {
            return v.toCSS();
          }).join(', ') + ']';
        } else {
          return obj.toCSS();
        }
      };
      module.exports = JsEvalNode;
    }, {
      "./node": 67,
      "./variable": 79
    }],
    62: [function(require, module, exports) {
      var Node = require("./node");
      var Keyword = function(value) {
        this.value = value;
      };
      Keyword.prototype = new Node();
      Keyword.prototype.type = "Keyword";
      Keyword.prototype.genCSS = function(context, output) {
        if (this.value === '%') {
          throw {
            type: "Syntax",
            message: "Invalid % without number"
          };
        }
        output.add(this.value);
      };
      Keyword.True = new Keyword('true');
      Keyword.False = new Keyword('false');
      module.exports = Keyword;
    }, {"./node": 67}],
    63: [function(require, module, exports) {
      var Ruleset = require("./ruleset"),
          Value = require("./value"),
          Element = require("./element"),
          Selector = require("./selector"),
          Anonymous = require("./anonymous"),
          Expression = require("./expression"),
          Directive = require("./directive");
      var Media = function(value, features, index, currentFileInfo) {
        this.index = index;
        this.currentFileInfo = currentFileInfo;
        var selectors = this.emptySelectors();
        this.features = new Value(features);
        this.rules = [new Ruleset(selectors, value)];
        this.rules[0].allowImports = true;
      };
      Media.prototype = new Directive();
      Media.prototype.type = "Media";
      Media.prototype.isRulesetLike = true;
      Media.prototype.accept = function(visitor) {
        if (this.features) {
          this.features = visitor.visit(this.features);
        }
        if (this.rules) {
          this.rules = visitor.visitArray(this.rules);
        }
      };
      Media.prototype.genCSS = function(context, output) {
        output.add('@media ', this.currentFileInfo, this.index);
        this.features.genCSS(context, output);
        this.outputRuleset(context, output, this.rules);
      };
      Media.prototype.eval = function(context) {
        if (!context.mediaBlocks) {
          context.mediaBlocks = [];
          context.mediaPath = [];
        }
        var media = new Media(null, [], this.index, this.currentFileInfo);
        if (this.debugInfo) {
          this.rules[0].debugInfo = this.debugInfo;
          media.debugInfo = this.debugInfo;
        }
        var strictMathBypass = false;
        if (!context.strictMath) {
          strictMathBypass = true;
          context.strictMath = true;
        }
        try {
          media.features = this.features.eval(context);
        } finally {
          if (strictMathBypass) {
            context.strictMath = false;
          }
        }
        context.mediaPath.push(media);
        context.mediaBlocks.push(media);
        context.frames.unshift(this.rules[0]);
        media.rules = [this.rules[0].eval(context)];
        context.frames.shift();
        context.mediaPath.pop();
        return context.mediaPath.length === 0 ? media.evalTop(context) : media.evalNested(context);
      };
      Media.prototype.variable = function(name) {
        return Ruleset.prototype.variable.call(this.rules[0], name);
      };
      Media.prototype.find = function() {
        return Ruleset.prototype.find.apply(this.rules[0], arguments);
      };
      Media.prototype.rulesets = function() {
        return Ruleset.prototype.rulesets.apply(this.rules[0]);
      };
      Media.prototype.emptySelectors = function() {
        var el = new Element('', '&', this.index, this.currentFileInfo),
            sels = [new Selector([el], null, null, this.index, this.currentFileInfo)];
        sels[0].mediaEmpty = true;
        return sels;
      };
      Media.prototype.markReferenced = function() {
        var i,
            rules = this.rules[0].rules;
        this.rules[0].markReferenced();
        this.isReferenced = true;
        for (i = 0; i < rules.length; i++) {
          if (rules[i].markReferenced) {
            rules[i].markReferenced();
          }
        }
      };
      Media.prototype.evalTop = function(context) {
        var result = this;
        if (context.mediaBlocks.length > 1) {
          var selectors = this.emptySelectors();
          result = new Ruleset(selectors, context.mediaBlocks);
          result.multiMedia = true;
        }
        delete context.mediaBlocks;
        delete context.mediaPath;
        return result;
      };
      Media.prototype.evalNested = function(context) {
        var i,
            value,
            path = context.mediaPath.concat([this]);
        for (i = 0; i < path.length; i++) {
          value = path[i].features instanceof Value ? path[i].features.value : path[i].features;
          path[i] = Array.isArray(value) ? value : [value];
        }
        this.features = new Value(this.permute(path).map(function(path) {
          path = path.map(function(fragment) {
            return fragment.toCSS ? fragment : new Anonymous(fragment);
          });
          for (i = path.length - 1; i > 0; i--) {
            path.splice(i, 0, new Anonymous("and"));
          }
          return new Expression(path);
        }));
        return new Ruleset([], []);
      };
      Media.prototype.permute = function(arr) {
        if (arr.length === 0) {
          return [];
        } else if (arr.length === 1) {
          return arr[0];
        } else {
          var result = [];
          var rest = this.permute(arr.slice(1));
          for (var i = 0; i < rest.length; i++) {
            for (var j = 0; j < arr[0].length; j++) {
              result.push([arr[0][j]].concat(rest[i]));
            }
          }
          return result;
        }
      };
      Media.prototype.bubbleSelectors = function(selectors) {
        if (!selectors) {
          return ;
        }
        this.rules = [new Ruleset(selectors.slice(0), [this.rules[0]])];
      };
      module.exports = Media;
    }, {
      "./anonymous": 43,
      "./directive": 54,
      "./element": 55,
      "./expression": 56,
      "./ruleset": 73,
      "./selector": 74,
      "./value": 78
    }],
    64: [function(require, module, exports) {
      var Node = require("./node"),
          Selector = require("./selector"),
          MixinDefinition = require("./mixin-definition"),
          defaultFunc = require("../functions/default");
      var MixinCall = function(elements, args, index, currentFileInfo, important) {
        this.selector = new Selector(elements);
        this.arguments = (args && args.length) ? args : null;
        this.index = index;
        this.currentFileInfo = currentFileInfo;
        this.important = important;
      };
      MixinCall.prototype = new Node();
      MixinCall.prototype.type = "MixinCall";
      MixinCall.prototype.accept = function(visitor) {
        if (this.selector) {
          this.selector = visitor.visit(this.selector);
        }
        if (this.arguments) {
          this.arguments = visitor.visitArray(this.arguments);
        }
      };
      MixinCall.prototype.eval = function(context) {
        var mixins,
            mixin,
            mixinPath,
            args,
            rules = [],
            match = false,
            i,
            m,
            f,
            isRecursive,
            isOneFound,
            rule,
            candidates = [],
            candidate,
            conditionResult = [],
            defaultResult,
            defFalseEitherCase = -1,
            defNone = 0,
            defTrue = 1,
            defFalse = 2,
            count,
            originalRuleset,
            noArgumentsFilter;
        function calcDefGroup(mixin, mixinPath) {
          var p,
              namespace;
          for (f = 0; f < 2; f++) {
            conditionResult[f] = true;
            defaultFunc.value(f);
            for (p = 0; p < mixinPath.length && conditionResult[f]; p++) {
              namespace = mixinPath[p];
              if (namespace.matchCondition) {
                conditionResult[f] = conditionResult[f] && namespace.matchCondition(null, context);
              }
            }
            if (mixin.matchCondition) {
              conditionResult[f] = conditionResult[f] && mixin.matchCondition(args, context);
            }
          }
          if (conditionResult[0] || conditionResult[1]) {
            if (conditionResult[0] != conditionResult[1]) {
              return conditionResult[1] ? defTrue : defFalse;
            }
            return defNone;
          }
          return defFalseEitherCase;
        }
        args = this.arguments && this.arguments.map(function(a) {
          return {
            name: a.name,
            value: a.value.eval(context)
          };
        });
        noArgumentsFilter = function(rule) {
          return rule.matchArgs(null, context);
        };
        for (i = 0; i < context.frames.length; i++) {
          if ((mixins = context.frames[i].find(this.selector, null, noArgumentsFilter)).length > 0) {
            isOneFound = true;
            for (m = 0; m < mixins.length; m++) {
              mixin = mixins[m].rule;
              mixinPath = mixins[m].path;
              isRecursive = false;
              for (f = 0; f < context.frames.length; f++) {
                if ((!(mixin instanceof MixinDefinition)) && mixin === (context.frames[f].originalRuleset || context.frames[f])) {
                  isRecursive = true;
                  break;
                }
              }
              if (isRecursive) {
                continue;
              }
              if (mixin.matchArgs(args, context)) {
                candidate = {
                  mixin: mixin,
                  group: calcDefGroup(mixin, mixinPath)
                };
                if (candidate.group !== defFalseEitherCase) {
                  candidates.push(candidate);
                }
                match = true;
              }
            }
            defaultFunc.reset();
            count = [0, 0, 0];
            for (m = 0; m < candidates.length; m++) {
              count[candidates[m].group]++;
            }
            if (count[defNone] > 0) {
              defaultResult = defFalse;
            } else {
              defaultResult = defTrue;
              if ((count[defTrue] + count[defFalse]) > 1) {
                throw {
                  type: 'Runtime',
                  message: 'Ambiguous use of `default()` found when matching for `' + this.format(args) + '`',
                  index: this.index,
                  filename: this.currentFileInfo.filename
                };
              }
            }
            for (m = 0; m < candidates.length; m++) {
              candidate = candidates[m].group;
              if ((candidate === defNone) || (candidate === defaultResult)) {
                try {
                  mixin = candidates[m].mixin;
                  if (!(mixin instanceof MixinDefinition)) {
                    originalRuleset = mixin.originalRuleset || mixin;
                    mixin = new MixinDefinition("", [], mixin.rules, null, false);
                    mixin.originalRuleset = originalRuleset;
                  }
                  Array.prototype.push.apply(rules, mixin.evalCall(context, args, this.important).rules);
                } catch (e) {
                  throw {
                    message: e.message,
                    index: this.index,
                    filename: this.currentFileInfo.filename,
                    stack: e.stack
                  };
                }
              }
            }
            if (match) {
              if (!this.currentFileInfo || !this.currentFileInfo.reference) {
                for (i = 0; i < rules.length; i++) {
                  rule = rules[i];
                  if (rule.markReferenced) {
                    rule.markReferenced();
                  }
                }
              }
              return rules;
            }
          }
        }
        if (isOneFound) {
          throw {
            type: 'Runtime',
            message: 'No matching definition was found for `' + this.format(args) + '`',
            index: this.index,
            filename: this.currentFileInfo.filename
          };
        } else {
          throw {
            type: 'Name',
            message: this.selector.toCSS().trim() + " is undefined",
            index: this.index,
            filename: this.currentFileInfo.filename
          };
        }
      };
      MixinCall.prototype.format = function(args) {
        return this.selector.toCSS().trim() + '(' + (args ? args.map(function(a) {
          var argValue = "";
          if (a.name) {
            argValue += a.name + ":";
          }
          if (a.value.toCSS) {
            argValue += a.value.toCSS();
          } else {
            argValue += "???";
          }
          return argValue;
        }).join(', ') : "") + ")";
      };
      module.exports = MixinCall;
    }, {
      "../functions/default": 19,
      "./mixin-definition": 65,
      "./node": 67,
      "./selector": 74
    }],
    65: [function(require, module, exports) {
      var Selector = require("./selector"),
          Element = require("./element"),
          Ruleset = require("./ruleset"),
          Rule = require("./rule"),
          Expression = require("./expression"),
          contexts = require("../contexts");
      var Definition = function(name, params, rules, condition, variadic, frames) {
        this.name = name;
        this.selectors = [new Selector([new Element(null, name, this.index, this.currentFileInfo)])];
        this.params = params;
        this.condition = condition;
        this.variadic = variadic;
        this.arity = params.length;
        this.rules = rules;
        this._lookups = {};
        this.required = params.reduce(function(count, p) {
          if (!p.name || (p.name && !p.value)) {
            return count + 1;
          } else {
            return count;
          }
        }, 0);
        this.frames = frames;
      };
      Definition.prototype = new Ruleset();
      Definition.prototype.type = "MixinDefinition";
      Definition.prototype.evalFirst = true;
      Definition.prototype.accept = function(visitor) {
        if (this.params && this.params.length) {
          this.params = visitor.visitArray(this.params);
        }
        this.rules = visitor.visitArray(this.rules);
        if (this.condition) {
          this.condition = visitor.visit(this.condition);
        }
      };
      Definition.prototype.evalParams = function(context, mixinEnv, args, evaldArguments) {
        var frame = new Ruleset(null, null),
            varargs,
            arg,
            params = this.params.slice(0),
            i,
            j,
            val,
            name,
            isNamedFound,
            argIndex,
            argsLength = 0;
        mixinEnv = new contexts.Eval(mixinEnv, [frame].concat(mixinEnv.frames));
        if (args) {
          args = args.slice(0);
          argsLength = args.length;
          for (i = 0; i < argsLength; i++) {
            arg = args[i];
            if (name = (arg && arg.name)) {
              isNamedFound = false;
              for (j = 0; j < params.length; j++) {
                if (!evaldArguments[j] && name === params[j].name) {
                  evaldArguments[j] = arg.value.eval(context);
                  frame.prependRule(new Rule(name, arg.value.eval(context)));
                  isNamedFound = true;
                  break;
                }
              }
              if (isNamedFound) {
                args.splice(i, 1);
                i--;
                continue;
              } else {
                throw {
                  type: 'Runtime',
                  message: "Named argument for " + this.name + ' ' + args[i].name + ' not found'
                };
              }
            }
          }
        }
        argIndex = 0;
        for (i = 0; i < params.length; i++) {
          if (evaldArguments[i]) {
            continue;
          }
          arg = args && args[argIndex];
          if (name = params[i].name) {
            if (params[i].variadic) {
              varargs = [];
              for (j = argIndex; j < argsLength; j++) {
                varargs.push(args[j].value.eval(context));
              }
              frame.prependRule(new Rule(name, new Expression(varargs).eval(context)));
            } else {
              val = arg && arg.value;
              if (val) {
                val = val.eval(context);
              } else if (params[i].value) {
                val = params[i].value.eval(mixinEnv);
                frame.resetCache();
              } else {
                throw {
                  type: 'Runtime',
                  message: "wrong number of arguments for " + this.name + ' (' + argsLength + ' for ' + this.arity + ')'
                };
              }
              frame.prependRule(new Rule(name, val));
              evaldArguments[i] = val;
            }
          }
          if (params[i].variadic && args) {
            for (j = argIndex; j < argsLength; j++) {
              evaldArguments[j] = args[j].value.eval(context);
            }
          }
          argIndex++;
        }
        return frame;
      };
      Definition.prototype.makeImportant = function() {
        var rules = !this.rules ? this.rules : this.rules.map(function(r) {
          if (r.makeImportant) {
            return r.makeImportant(true);
          } else {
            return r;
          }
        });
        var result = new Definition(this.name, this.params, rules, this.condition, this.variadic, this.frames);
        return result;
      };
      Definition.prototype.eval = function(context) {
        return new Definition(this.name, this.params, this.rules, this.condition, this.variadic, this.frames || context.frames.slice(0));
      };
      Definition.prototype.evalCall = function(context, args, important) {
        var _arguments = [],
            mixinFrames = this.frames ? this.frames.concat(context.frames) : context.frames,
            frame = this.evalParams(context, new contexts.Eval(context, mixinFrames), args, _arguments),
            rules,
            ruleset;
        frame.prependRule(new Rule('@arguments', new Expression(_arguments).eval(context)));
        rules = this.rules.slice(0);
        ruleset = new Ruleset(null, rules);
        ruleset.originalRuleset = this;
        ruleset = ruleset.eval(new contexts.Eval(context, [this, frame].concat(mixinFrames)));
        if (important) {
          ruleset = ruleset.makeImportant();
        }
        return ruleset;
      };
      Definition.prototype.matchCondition = function(args, context) {
        if (this.condition && !this.condition.eval(new contexts.Eval(context, [this.evalParams(context, new contexts.Eval(context, this.frames ? this.frames.concat(context.frames) : context.frames), args, [])].concat(this.frames).concat(context.frames)))) {
          return false;
        }
        return true;
      };
      Definition.prototype.matchArgs = function(args, context) {
        var argsLength = (args && args.length) || 0,
            len;
        if (!this.variadic) {
          if (argsLength < this.required) {
            return false;
          }
          if (argsLength > this.params.length) {
            return false;
          }
        } else {
          if (argsLength < (this.required - 1)) {
            return false;
          }
        }
        len = Math.min(argsLength, this.arity);
        for (var i = 0; i < len; i++) {
          if (!this.params[i].name && !this.params[i].variadic) {
            if (args[i].value.eval(context).toCSS() != this.params[i].value.eval(context).toCSS()) {
              return false;
            }
          }
        }
        return true;
      };
      module.exports = Definition;
    }, {
      "../contexts": 10,
      "./element": 55,
      "./expression": 56,
      "./rule": 71,
      "./ruleset": 73,
      "./selector": 74
    }],
    66: [function(require, module, exports) {
      var Node = require("./node"),
          Operation = require("./operation"),
          Dimension = require("./dimension");
      var Negative = function(node) {
        this.value = node;
      };
      Negative.prototype = new Node();
      Negative.prototype.type = "Negative";
      Negative.prototype.genCSS = function(context, output) {
        output.add('-');
        this.value.genCSS(context, output);
      };
      Negative.prototype.eval = function(context) {
        if (context.isMathOn()) {
          return (new Operation('*', [new Dimension(-1), this.value])).eval(context);
        }
        return new Negative(this.value.eval(context));
      };
      module.exports = Negative;
    }, {
      "./dimension": 53,
      "./node": 67,
      "./operation": 68
    }],
    67: [function(require, module, exports) {
      var Node = function() {};
      Node.prototype.toCSS = function(context) {
        var strs = [];
        this.genCSS(context, {
          add: function(chunk, fileInfo, index) {
            strs.push(chunk);
          },
          isEmpty: function() {
            return strs.length === 0;
          }
        });
        return strs.join('');
      };
      Node.prototype.genCSS = function(context, output) {
        output.add(this.value);
      };
      Node.prototype.accept = function(visitor) {
        this.value = visitor.visit(this.value);
      };
      Node.prototype.eval = function() {
        return this;
      };
      Node.prototype._operate = function(context, op, a, b) {
        switch (op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return a / b;
        }
      };
      Node.prototype.fround = function(context, value) {
        var precision = context && context.numPrecision;
        return (precision == null) ? value : Number((value + 2e-16).toFixed(precision));
      };
      Node.compare = function(a, b) {
        if ((a.compare) && !(b.type === "Quoted" || b.type === "Anonymous")) {
          return a.compare(b);
        } else if (b.compare) {
          return -b.compare(a);
        } else if (a.type !== b.type) {
          return undefined;
        }
        a = a.value;
        b = b.value;
        if (!Array.isArray(a)) {
          return a === b ? 0 : undefined;
        }
        if (a.length !== b.length) {
          return undefined;
        }
        for (var i = 0; i < a.length; i++) {
          if (Node.compare(a[i], b[i]) !== 0) {
            return undefined;
          }
        }
        return 0;
      };
      Node.numericCompare = function(a, b) {
        return a < b ? -1 : a === b ? 0 : a > b ? 1 : undefined;
      };
      module.exports = Node;
    }, {}],
    68: [function(require, module, exports) {
      var Node = require("./node"),
          Color = require("./color"),
          Dimension = require("./dimension");
      var Operation = function(op, operands, isSpaced) {
        this.op = op.trim();
        this.operands = operands;
        this.isSpaced = isSpaced;
      };
      Operation.prototype = new Node();
      Operation.prototype.type = "Operation";
      Operation.prototype.accept = function(visitor) {
        this.operands = visitor.visit(this.operands);
      };
      Operation.prototype.eval = function(context) {
        var a = this.operands[0].eval(context),
            b = this.operands[1].eval(context);
        if (context.isMathOn()) {
          if (a instanceof Dimension && b instanceof Color) {
            a = a.toColor();
          }
          if (b instanceof Dimension && a instanceof Color) {
            b = b.toColor();
          }
          if (!a.operate) {
            throw {
              type: "Operation",
              message: "Operation on an invalid type"
            };
          }
          return a.operate(context, this.op, b);
        } else {
          return new Operation(this.op, [a, b], this.isSpaced);
        }
      };
      Operation.prototype.genCSS = function(context, output) {
        this.operands[0].genCSS(context, output);
        if (this.isSpaced) {
          output.add(" ");
        }
        output.add(this.op);
        if (this.isSpaced) {
          output.add(" ");
        }
        this.operands[1].genCSS(context, output);
      };
      module.exports = Operation;
    }, {
      "./color": 47,
      "./dimension": 53,
      "./node": 67
    }],
    69: [function(require, module, exports) {
      var Node = require("./node");
      var Paren = function(node) {
        this.value = node;
      };
      Paren.prototype = new Node();
      Paren.prototype.type = "Paren";
      Paren.prototype.genCSS = function(context, output) {
        output.add('(');
        this.value.genCSS(context, output);
        output.add(')');
      };
      Paren.prototype.eval = function(context) {
        return new Paren(this.value.eval(context));
      };
      module.exports = Paren;
    }, {"./node": 67}],
    70: [function(require, module, exports) {
      var Node = require("./node"),
          JsEvalNode = require("./js-eval-node"),
          Variable = require("./variable");
      var Quoted = function(str, content, escaped, index, currentFileInfo) {
        this.escaped = (escaped == null) ? true : escaped;
        this.value = content || '';
        this.quote = str.charAt(0);
        this.index = index;
        this.currentFileInfo = currentFileInfo;
      };
      Quoted.prototype = new JsEvalNode();
      Quoted.prototype.type = "Quoted";
      Quoted.prototype.genCSS = function(context, output) {
        if (!this.escaped) {
          output.add(this.quote, this.currentFileInfo, this.index);
        }
        output.add(this.value);
        if (!this.escaped) {
          output.add(this.quote);
        }
      };
      Quoted.prototype.containsVariables = function() {
        return this.value.match(/(`([^`]+)`)|@\{([\w-]+)\}/);
      };
      Quoted.prototype.eval = function(context) {
        var that = this,
            value = this.value;
        var javascriptReplacement = function(_, exp) {
          return String(that.evaluateJavaScript(exp, context));
        };
        var interpolationReplacement = function(_, name) {
          var v = new Variable('@' + name, that.index, that.currentFileInfo).eval(context, true);
          return (v instanceof Quoted) ? v.value : v.toCSS();
        };
        function iterativeReplace(value, regexp, replacementFnc) {
          var evaluatedValue = value;
          do {
            value = evaluatedValue;
            evaluatedValue = value.replace(regexp, replacementFnc);
          } while (value !== evaluatedValue);
          return evaluatedValue;
        }
        value = iterativeReplace(value, /`([^`]+)`/g, javascriptReplacement);
        value = iterativeReplace(value, /@\{([\w-]+)\}/g, interpolationReplacement);
        return new Quoted(this.quote + value + this.quote, value, this.escaped, this.index, this.currentFileInfo);
      };
      Quoted.prototype.compare = function(other) {
        if (other.type === "Quoted" && !this.escaped && !other.escaped) {
          return Node.numericCompare(this.value, other.value);
        } else {
          return other.toCSS && this.toCSS() === other.toCSS() ? 0 : undefined;
        }
      };
      module.exports = Quoted;
    }, {
      "./js-eval-node": 61,
      "./node": 67,
      "./variable": 79
    }],
    71: [function(require, module, exports) {
      var Node = require("./node"),
          Value = require("./value"),
          Keyword = require("./keyword");
      var Rule = function(name, value, important, merge, index, currentFileInfo, inline, variable) {
        this.name = name;
        this.value = (value instanceof Node) ? value : new Value([value]);
        this.important = important ? ' ' + important.trim() : '';
        this.merge = merge;
        this.index = index;
        this.currentFileInfo = currentFileInfo;
        this.inline = inline || false;
        this.variable = (variable !== undefined) ? variable : (name.charAt && (name.charAt(0) === '@'));
      };
      function evalName(context, name) {
        var value = "",
            i,
            n = name.length,
            output = {add: function(s) {
                value += s;
              }};
        for (i = 0; i < n; i++) {
          name[i].eval(context).genCSS(context, output);
        }
        return value;
      }
      Rule.prototype = new Node();
      Rule.prototype.type = "Rule";
      Rule.prototype.genCSS = function(context, output) {
        output.add(this.name + (context.compress ? ':' : ': '), this.currentFileInfo, this.index);
        try {
          this.value.genCSS(context, output);
        } catch (e) {
          e.index = this.index;
          e.filename = this.currentFileInfo.filename;
          throw e;
        }
        output.add(this.important + ((this.inline || (context.lastRule && context.compress)) ? "" : ";"), this.currentFileInfo, this.index);
      };
      Rule.prototype.eval = function(context) {
        var strictMathBypass = false,
            name = this.name,
            evaldValue,
            variable = this.variable;
        if (typeof name !== "string") {
          name = (name.length === 1) && (name[0] instanceof Keyword) ? name[0].value : evalName(context, name);
          variable = false;
        }
        if (name === "font" && !context.strictMath) {
          strictMathBypass = true;
          context.strictMath = true;
        }
        try {
          context.importantScope.push({});
          evaldValue = this.value.eval(context);
          if (!this.variable && evaldValue.type === "DetachedRuleset") {
            throw {
              message: "Rulesets cannot be evaluated on a property.",
              index: this.index,
              filename: this.currentFileInfo.filename
            };
          }
          var important = this.important,
              importantResult = context.importantScope.pop();
          if (!important && importantResult.important) {
            important = importantResult.important;
          }
          return new Rule(name, evaldValue, important, this.merge, this.index, this.currentFileInfo, this.inline, variable);
        } catch (e) {
          if (typeof e.index !== 'number') {
            e.index = this.index;
            e.filename = this.currentFileInfo.filename;
          }
          throw e;
        } finally {
          if (strictMathBypass) {
            context.strictMath = false;
          }
        }
      };
      Rule.prototype.makeImportant = function() {
        return new Rule(this.name, this.value, "!important", this.merge, this.index, this.currentFileInfo, this.inline);
      };
      module.exports = Rule;
    }, {
      "./keyword": 62,
      "./node": 67,
      "./value": 78
    }],
    72: [function(require, module, exports) {
      var Node = require("./node"),
          Variable = require("./variable");
      var RulesetCall = function(variable) {
        this.variable = variable;
      };
      RulesetCall.prototype = new Node();
      RulesetCall.prototype.type = "RulesetCall";
      RulesetCall.prototype.eval = function(context) {
        var detachedRuleset = new Variable(this.variable).eval(context);
        return detachedRuleset.callEval(context);
      };
      module.exports = RulesetCall;
    }, {
      "./node": 67,
      "./variable": 79
    }],
    73: [function(require, module, exports) {
      var Node = require("./node"),
          Rule = require("./rule"),
          Selector = require("./selector"),
          Element = require("./element"),
          Paren = require("./paren"),
          contexts = require("../contexts"),
          defaultFunc = require("../functions/default"),
          getDebugInfo = require("./debug-info");
      var Ruleset = function(selectors, rules, strictImports) {
        this.selectors = selectors;
        this.rules = rules;
        this._lookups = {};
        this.strictImports = strictImports;
      };
      Ruleset.prototype = new Node();
      Ruleset.prototype.type = "Ruleset";
      Ruleset.prototype.isRuleset = true;
      Ruleset.prototype.isRulesetLike = true;
      Ruleset.prototype.accept = function(visitor) {
        if (this.paths) {
          visitor.visitArray(this.paths, true);
        } else if (this.selectors) {
          this.selectors = visitor.visitArray(this.selectors);
        }
        if (this.rules && this.rules.length) {
          this.rules = visitor.visitArray(this.rules);
        }
      };
      Ruleset.prototype.eval = function(context) {
        var thisSelectors = this.selectors,
            selectors,
            selCnt,
            selector,
            i,
            hasOnePassingSelector = false;
        if (thisSelectors && (selCnt = thisSelectors.length)) {
          selectors = [];
          defaultFunc.error({
            type: "Syntax",
            message: "it is currently only allowed in parametric mixin guards,"
          });
          for (i = 0; i < selCnt; i++) {
            selector = thisSelectors[i].eval(context);
            selectors.push(selector);
            if (selector.evaldCondition) {
              hasOnePassingSelector = true;
            }
          }
          defaultFunc.reset();
        } else {
          hasOnePassingSelector = true;
        }
        var rules = this.rules ? this.rules.slice(0) : null,
            ruleset = new Ruleset(selectors, rules, this.strictImports),
            rule,
            subRule;
        ruleset.originalRuleset = this;
        ruleset.root = this.root;
        ruleset.firstRoot = this.firstRoot;
        ruleset.allowImports = this.allowImports;
        if (this.debugInfo) {
          ruleset.debugInfo = this.debugInfo;
        }
        if (!hasOnePassingSelector) {
          rules.length = 0;
        }
        var ctxFrames = context.frames;
        ctxFrames.unshift(ruleset);
        var ctxSelectors = context.selectors;
        if (!ctxSelectors) {
          context.selectors = ctxSelectors = [];
        }
        ctxSelectors.unshift(this.selectors);
        if (ruleset.root || ruleset.allowImports || !ruleset.strictImports) {
          ruleset.evalImports(context);
        }
        var rsRules = ruleset.rules,
            rsRuleCnt = rsRules ? rsRules.length : 0;
        for (i = 0; i < rsRuleCnt; i++) {
          if (rsRules[i].evalFirst) {
            rsRules[i] = rsRules[i].eval(context);
          }
        }
        var mediaBlockCount = (context.mediaBlocks && context.mediaBlocks.length) || 0;
        for (i = 0; i < rsRuleCnt; i++) {
          if (rsRules[i].type === "MixinCall") {
            rules = rsRules[i].eval(context).filter(function(r) {
              if ((r instanceof Rule) && r.variable) {
                return !(ruleset.variable(r.name));
              }
              return true;
            });
            rsRules.splice.apply(rsRules, [i, 1].concat(rules));
            rsRuleCnt += rules.length - 1;
            i += rules.length - 1;
            ruleset.resetCache();
          } else if (rsRules[i].type === "RulesetCall") {
            rules = rsRules[i].eval(context).rules.filter(function(r) {
              if ((r instanceof Rule) && r.variable) {
                return false;
              }
              return true;
            });
            rsRules.splice.apply(rsRules, [i, 1].concat(rules));
            rsRuleCnt += rules.length - 1;
            i += rules.length - 1;
            ruleset.resetCache();
          }
        }
        for (i = 0; i < rsRules.length; i++) {
          rule = rsRules[i];
          if (!rule.evalFirst) {
            rsRules[i] = rule = rule.eval ? rule.eval(context) : rule;
          }
        }
        for (i = 0; i < rsRules.length; i++) {
          rule = rsRules[i];
          if (rule instanceof Ruleset && rule.selectors && rule.selectors.length === 1) {
            if (rule.selectors[0].isJustParentSelector()) {
              rsRules.splice(i--, 1);
              for (var j = 0; j < rule.rules.length; j++) {
                subRule = rule.rules[j];
                if (!(subRule instanceof Rule) || !subRule.variable) {
                  rsRules.splice(++i, 0, subRule);
                }
              }
            }
          }
        }
        ctxFrames.shift();
        ctxSelectors.shift();
        if (context.mediaBlocks) {
          for (i = mediaBlockCount; i < context.mediaBlocks.length; i++) {
            context.mediaBlocks[i].bubbleSelectors(selectors);
          }
        }
        return ruleset;
      };
      Ruleset.prototype.evalImports = function(context) {
        var rules = this.rules,
            i,
            importRules;
        if (!rules) {
          return ;
        }
        for (i = 0; i < rules.length; i++) {
          if (rules[i].type === "Import") {
            importRules = rules[i].eval(context);
            if (importRules && importRules.length) {
              rules.splice.apply(rules, [i, 1].concat(importRules));
              i += importRules.length - 1;
            } else {
              rules.splice(i, 1, importRules);
            }
            this.resetCache();
          }
        }
      };
      Ruleset.prototype.makeImportant = function() {
        var result = new Ruleset(this.selectors, this.rules.map(function(r) {
          if (r.makeImportant) {
            return r.makeImportant();
          } else {
            return r;
          }
        }), this.strictImports);
        return result;
      };
      Ruleset.prototype.matchArgs = function(args) {
        return !args || args.length === 0;
      };
      Ruleset.prototype.matchCondition = function(args, context) {
        var lastSelector = this.selectors[this.selectors.length - 1];
        if (!lastSelector.evaldCondition) {
          return false;
        }
        if (lastSelector.condition && !lastSelector.condition.eval(new contexts.Eval(context, context.frames))) {
          return false;
        }
        return true;
      };
      Ruleset.prototype.resetCache = function() {
        this._rulesets = null;
        this._variables = null;
        this._lookups = {};
      };
      Ruleset.prototype.variables = function() {
        if (!this._variables) {
          this._variables = !this.rules ? {} : this.rules.reduce(function(hash, r) {
            if (r instanceof Rule && r.variable === true) {
              hash[r.name] = r;
            }
            if (r.type === "Import" && r.root && r.root.variables) {
              var vars = r.root.variables();
              for (var name in vars) {
                if (vars.hasOwnProperty(name)) {
                  hash[name] = vars[name];
                }
              }
            }
            return hash;
          }, {});
        }
        return this._variables;
      };
      Ruleset.prototype.variable = function(name) {
        return this.variables()[name];
      };
      Ruleset.prototype.rulesets = function() {
        if (!this.rules) {
          return null;
        }
        var filtRules = [],
            rules = this.rules,
            cnt = rules.length,
            i,
            rule;
        for (i = 0; i < cnt; i++) {
          rule = rules[i];
          if (rule.isRuleset) {
            filtRules.push(rule);
          }
        }
        return filtRules;
      };
      Ruleset.prototype.prependRule = function(rule) {
        var rules = this.rules;
        if (rules) {
          rules.unshift(rule);
        } else {
          this.rules = [rule];
        }
      };
      Ruleset.prototype.find = function(selector, self, filter) {
        self = self || this;
        var rules = [],
            match,
            foundMixins,
            key = selector.toCSS();
        if (key in this._lookups) {
          return this._lookups[key];
        }
        this.rulesets().forEach(function(rule) {
          if (rule !== self) {
            for (var j = 0; j < rule.selectors.length; j++) {
              match = selector.match(rule.selectors[j]);
              if (match) {
                if (selector.elements.length > match) {
                  if (!filter || filter(rule)) {
                    foundMixins = rule.find(new Selector(selector.elements.slice(match)), self, filter);
                    for (var i = 0; i < foundMixins.length; ++i) {
                      foundMixins[i].path.push(rule);
                    }
                    Array.prototype.push.apply(rules, foundMixins);
                  }
                } else {
                  rules.push({
                    rule: rule,
                    path: []
                  });
                }
                break;
              }
            }
          }
        });
        this._lookups[key] = rules;
        return rules;
      };
      Ruleset.prototype.genCSS = function(context, output) {
        var i,
            j,
            charsetRuleNodes = [],
            ruleNodes = [],
            rulesetNodes = [],
            rulesetNodeCnt,
            debugInfo,
            rule,
            path;
        context.tabLevel = (context.tabLevel || 0);
        if (!this.root) {
          context.tabLevel++;
        }
        var tabRuleStr = context.compress ? '' : Array(context.tabLevel + 1).join("  "),
            tabSetStr = context.compress ? '' : Array(context.tabLevel).join("  "),
            sep;
        function isRulesetLikeNode(rule, root) {
          if (typeof rule.isRulesetLike === "boolean") {
            return rule.isRulesetLike;
          } else if (typeof rule.isRulesetLike === "function") {
            return rule.isRulesetLike(root);
          }
          return false;
        }
        for (i = 0; i < this.rules.length; i++) {
          rule = this.rules[i];
          if (isRulesetLikeNode(rule, this.root)) {
            rulesetNodes.push(rule);
          } else {
            if (rule.isCharset && rule.isCharset()) {
              charsetRuleNodes.push(rule);
            } else {
              ruleNodes.push(rule);
            }
          }
        }
        ruleNodes = charsetRuleNodes.concat(ruleNodes);
        if (!this.root) {
          debugInfo = getDebugInfo(context, this, tabSetStr);
          if (debugInfo) {
            output.add(debugInfo);
            output.add(tabSetStr);
          }
          var paths = this.paths,
              pathCnt = paths.length,
              pathSubCnt;
          sep = context.compress ? ',' : (',\n' + tabSetStr);
          for (i = 0; i < pathCnt; i++) {
            path = paths[i];
            if (!(pathSubCnt = path.length)) {
              continue;
            }
            if (i > 0) {
              output.add(sep);
            }
            context.firstSelector = true;
            path[0].genCSS(context, output);
            context.firstSelector = false;
            for (j = 1; j < pathSubCnt; j++) {
              path[j].genCSS(context, output);
            }
          }
          output.add((context.compress ? '{' : ' {\n') + tabRuleStr);
        }
        for (i = 0; i < ruleNodes.length; i++) {
          rule = ruleNodes[i];
          if (i + 1 === ruleNodes.length && (!this.root || rulesetNodes.length === 0 || this.firstRoot)) {
            context.lastRule = true;
          }
          if (rule.genCSS) {
            rule.genCSS(context, output);
          } else if (rule.value) {
            output.add(rule.value.toString());
          }
          if (!context.lastRule) {
            output.add(context.compress ? '' : ('\n' + tabRuleStr));
          } else {
            context.lastRule = false;
          }
        }
        if (!this.root) {
          output.add((context.compress ? '}' : '\n' + tabSetStr + '}'));
          context.tabLevel--;
        }
        sep = (context.compress ? "" : "\n") + (this.root ? tabRuleStr : tabSetStr);
        rulesetNodeCnt = rulesetNodes.length;
        if (rulesetNodeCnt) {
          if (ruleNodes.length && sep) {
            output.add(sep);
          }
          rulesetNodes[0].genCSS(context, output);
          for (i = 1; i < rulesetNodeCnt; i++) {
            if (sep) {
              output.add(sep);
            }
            rulesetNodes[i].genCSS(context, output);
          }
        }
        if (!output.isEmpty() && !context.compress && this.firstRoot) {
          output.add('\n');
        }
      };
      Ruleset.prototype.markReferenced = function() {
        var s;
        if (this.selectors) {
          for (s = 0; s < this.selectors.length; s++) {
            this.selectors[s].markReferenced();
          }
        }
        if (this.rules) {
          for (s = 0; s < this.rules.length; s++) {
            if (this.rules[s].markReferenced) {
              this.rules[s].markReferenced();
            }
          }
        }
      };
      Ruleset.prototype.getIsReferenced = function() {
        var i,
            j,
            path,
            selector;
        if (this.paths) {
          for (i = 0; i < this.paths.length; i++) {
            path = this.paths[i];
            for (j = 0; j < path.length; j++) {
              if (path[j].getIsReferenced && path[j].getIsReferenced()) {
                return true;
              }
            }
          }
        }
        if (this.selectors) {
          for (i = 0; i < this.selectors.length; i++) {
            selector = this.selectors[i];
            if (selector.getIsReferenced && selector.getIsReferenced()) {
              return true;
            }
          }
        }
        return false;
      };
      Ruleset.prototype.joinSelectors = function(paths, context, selectors) {
        for (var s = 0; s < selectors.length; s++) {
          this.joinSelector(paths, context, selectors[s]);
        }
      };
      Ruleset.prototype.joinSelector = function(paths, context, selector) {
        function createParenthesis(elementsToPak, originalElement) {
          var replacementParen,
              j;
          if (elementsToPak.length === 0) {
            replacementParen = new Paren(elementsToPak[0]);
          } else {
            var insideParent = [];
            for (j = 0; j < elementsToPak.length; j++) {
              insideParent.push(new Element(null, elementsToPak[j], originalElement.index, originalElement.currentFileInfo));
            }
            replacementParen = new Paren(new Selector(insideParent));
          }
          return replacementParen;
        }
        function createSelector(containedElement, originalElement) {
          var element,
              selector;
          element = new Element(null, containedElement, originalElement.index, originalElement.currentFileInfo);
          selector = new Selector([element]);
          return selector;
        }
        function replaceParentSelector(paths, context, inSelector) {
          var i,
              j,
              k,
              currentElements,
              newSelectors,
              selectorsMultiplied,
              sel,
              el,
              hadParentSelector = false,
              length,
              lastSelector;
          function findNestedSelector(element) {
            var maybeSelector;
            if (element.value.type !== 'Paren') {
              return null;
            }
            maybeSelector = element.value.value;
            if (maybeSelector.type !== 'Selector') {
              return null;
            }
            return maybeSelector;
          }
          currentElements = [];
          newSelectors = [[]];
          for (i = 0; i < inSelector.elements.length; i++) {
            el = inSelector.elements[i];
            if (el.value !== "&") {
              var nestedSelector = findNestedSelector(el);
              if (nestedSelector != null) {
                mergeElementsOnToSelectors(currentElements, newSelectors);
                var nestedPaths = [],
                    replaced,
                    replacedNewSelectors = [];
                replaced = replaceParentSelector(nestedPaths, context, nestedSelector);
                hadParentSelector = hadParentSelector || replaced;
                for (k = 0; k < nestedPaths.length; k++) {
                  var replacementSelector = createSelector(createParenthesis(nestedPaths[k], el), el);
                  addAllReplacementsIntoPath(newSelectors, [replacementSelector], el, inSelector, replacedNewSelectors);
                }
                newSelectors = replacedNewSelectors;
                currentElements = [];
              } else {
                currentElements.push(el);
              }
            } else {
              hadParentSelector = true;
              selectorsMultiplied = [];
              mergeElementsOnToSelectors(currentElements, newSelectors);
              for (j = 0; j < newSelectors.length; j++) {
                sel = newSelectors[j];
                if (context.length === 0) {
                  if (sel.length > 0) {
                    sel[0].elements.push(new Element(el.combinator, '', el.index, el.currentFileInfo));
                  }
                  selectorsMultiplied.push(sel);
                } else {
                  for (k = 0; k < context.length; k++) {
                    var newSelectorPath = addReplacementIntoPath(sel, context[k], el, inSelector);
                    selectorsMultiplied.push(newSelectorPath);
                  }
                }
              }
              newSelectors = selectorsMultiplied;
              currentElements = [];
            }
          }
          mergeElementsOnToSelectors(currentElements, newSelectors);
          for (i = 0; i < newSelectors.length; i++) {
            length = newSelectors[i].length;
            if (length > 0) {
              paths.push(newSelectors[i]);
              lastSelector = newSelectors[i][length - 1];
              newSelectors[i][length - 1] = lastSelector.createDerived(lastSelector.elements, inSelector.extendList);
            }
          }
          return hadParentSelector;
        }
        function addReplacementIntoPath(beginningPath, addPath, replacedElement, originalSelector) {
          var newSelectorPath,
              lastSelector,
              newJoinedSelector;
          newSelectorPath = [];
          if (beginningPath.length > 0) {
            newSelectorPath = beginningPath.slice(0);
            lastSelector = newSelectorPath.pop();
            newJoinedSelector = originalSelector.createDerived(lastSelector.elements.slice(0));
          } else {
            newJoinedSelector = originalSelector.createDerived([]);
          }
          if (addPath.length > 0) {
            var combinator = replacedElement.combinator,
                parentEl = addPath[0].elements[0];
            if (combinator.emptyOrWhitespace && !parentEl.combinator.emptyOrWhitespace) {
              combinator = parentEl.combinator;
            }
            newJoinedSelector.elements.push(new Element(combinator, parentEl.value, replacedElement.index, replacedElement.currentFileInfo));
            newJoinedSelector.elements = newJoinedSelector.elements.concat(addPath[0].elements.slice(1));
          }
          if (newJoinedSelector.elements.length !== 0) {
            newSelectorPath.push(newJoinedSelector);
          }
          if (addPath.length > 1) {
            newSelectorPath = newSelectorPath.concat(addPath.slice(1));
          }
          return newSelectorPath;
        }
        function addAllReplacementsIntoPath(beginningPath, addPaths, replacedElement, originalSelector, result) {
          var j;
          for (j = 0; j < beginningPath.length; j++) {
            var newSelectorPath = addReplacementIntoPath(beginningPath[j], addPaths, replacedElement, originalSelector);
            result.push(newSelectorPath);
          }
          return result;
        }
        function mergeElementsOnToSelectors(elements, selectors) {
          var i,
              sel;
          if (elements.length === 0) {
            return ;
          }
          if (selectors.length === 0) {
            selectors.push([new Selector(elements)]);
            return ;
          }
          for (i = 0; i < selectors.length; i++) {
            sel = selectors[i];
            if (sel.length > 0) {
              sel[sel.length - 1] = sel[sel.length - 1].createDerived(sel[sel.length - 1].elements.concat(elements));
            } else {
              sel.push(new Selector(elements));
            }
          }
        }
        var i,
            newPaths,
            hadParentSelector;
        newPaths = [];
        hadParentSelector = replaceParentSelector(newPaths, context, selector);
        if (!hadParentSelector) {
          if (context.length > 0) {
            newPaths = [];
            for (i = 0; i < context.length; i++) {
              newPaths.push(context[i].concat(selector));
            }
          } else {
            newPaths = [[selector]];
          }
        }
        for (i = 0; i < newPaths.length; i++) {
          paths.push(newPaths[i]);
        }
      };
      module.exports = Ruleset;
    }, {
      "../contexts": 10,
      "../functions/default": 19,
      "./debug-info": 51,
      "./element": 55,
      "./node": 67,
      "./paren": 69,
      "./rule": 71,
      "./selector": 74
    }],
    74: [function(require, module, exports) {
      var Node = require("./node");
      var Selector = function(elements, extendList, condition, index, currentFileInfo, isReferenced) {
        this.elements = elements;
        this.extendList = extendList;
        this.condition = condition;
        this.currentFileInfo = currentFileInfo || {};
        this.isReferenced = isReferenced;
        if (!condition) {
          this.evaldCondition = true;
        }
      };
      Selector.prototype = new Node();
      Selector.prototype.type = "Selector";
      Selector.prototype.accept = function(visitor) {
        if (this.elements) {
          this.elements = visitor.visitArray(this.elements);
        }
        if (this.extendList) {
          this.extendList = visitor.visitArray(this.extendList);
        }
        if (this.condition) {
          this.condition = visitor.visit(this.condition);
        }
      };
      Selector.prototype.createDerived = function(elements, extendList, evaldCondition) {
        evaldCondition = (evaldCondition != null) ? evaldCondition : this.evaldCondition;
        var newSelector = new Selector(elements, extendList || this.extendList, null, this.index, this.currentFileInfo, this.isReferenced);
        newSelector.evaldCondition = evaldCondition;
        newSelector.mediaEmpty = this.mediaEmpty;
        return newSelector;
      };
      Selector.prototype.match = function(other) {
        var elements = this.elements,
            len = elements.length,
            olen,
            i;
        other.CacheElements();
        olen = other._elements.length;
        if (olen === 0 || len < olen) {
          return 0;
        } else {
          for (i = 0; i < olen; i++) {
            if (elements[i].value !== other._elements[i]) {
              return 0;
            }
          }
        }
        return olen;
      };
      Selector.prototype.CacheElements = function() {
        if (this._elements) {
          return ;
        }
        var elements = this.elements.map(function(v) {
          return v.combinator.value + (v.value.value || v.value);
        }).join("").match(/[,&#\*\.\w-]([\w-]|(\\.))*/g);
        if (elements) {
          if (elements[0] === "&") {
            elements.shift();
          }
        } else {
          elements = [];
        }
        this._elements = elements;
      };
      Selector.prototype.isJustParentSelector = function() {
        return !this.mediaEmpty && this.elements.length === 1 && this.elements[0].value === '&' && (this.elements[0].combinator.value === ' ' || this.elements[0].combinator.value === '');
      };
      Selector.prototype.eval = function(context) {
        var evaldCondition = this.condition && this.condition.eval(context),
            elements = this.elements,
            extendList = this.extendList;
        elements = elements && elements.map(function(e) {
          return e.eval(context);
        });
        extendList = extendList && extendList.map(function(extend) {
          return extend.eval(context);
        });
        return this.createDerived(elements, extendList, evaldCondition);
      };
      Selector.prototype.genCSS = function(context, output) {
        var i,
            element;
        if ((!context || !context.firstSelector) && this.elements[0].combinator.value === "") {
          output.add(' ', this.currentFileInfo, this.index);
        }
        if (!this._css) {
          for (i = 0; i < this.elements.length; i++) {
            element = this.elements[i];
            element.genCSS(context, output);
          }
        }
      };
      Selector.prototype.markReferenced = function() {
        this.isReferenced = true;
      };
      Selector.prototype.getIsReferenced = function() {
        return !this.currentFileInfo.reference || this.isReferenced;
      };
      Selector.prototype.getIsOutput = function() {
        return this.evaldCondition;
      };
      module.exports = Selector;
    }, {"./node": 67}],
    75: [function(require, module, exports) {
      var Node = require("./node");
      var UnicodeDescriptor = function(value) {
        this.value = value;
      };
      UnicodeDescriptor.prototype = new Node();
      UnicodeDescriptor.prototype.type = "UnicodeDescriptor";
      module.exports = UnicodeDescriptor;
    }, {"./node": 67}],
    76: [function(require, module, exports) {
      var Node = require("./node"),
          unitConversions = require("../data/unit-conversions");
      var Unit = function(numerator, denominator, backupUnit) {
        this.numerator = numerator ? numerator.slice(0).sort() : [];
        this.denominator = denominator ? denominator.slice(0).sort() : [];
        if (backupUnit) {
          this.backupUnit = backupUnit;
        } else if (numerator && numerator.length) {
          this.backupUnit = numerator[0];
        }
      };
      Unit.prototype = new Node();
      Unit.prototype.type = "Unit";
      Unit.prototype.clone = function() {
        return new Unit(this.numerator.slice(0), this.denominator.slice(0), this.backupUnit);
      };
      Unit.prototype.genCSS = function(context, output) {
        var strictUnits = context && context.strictUnits;
        if (this.numerator.length === 1) {
          output.add(this.numerator[0]);
        } else if (!strictUnits && this.backupUnit) {
          output.add(this.backupUnit);
        } else if (!strictUnits && this.denominator.length) {
          output.add(this.denominator[0]);
        }
      };
      Unit.prototype.toString = function() {
        var i,
            returnStr = this.numerator.join("*");
        for (i = 0; i < this.denominator.length; i++) {
          returnStr += "/" + this.denominator[i];
        }
        return returnStr;
      };
      Unit.prototype.compare = function(other) {
        return this.is(other.toString()) ? 0 : undefined;
      };
      Unit.prototype.is = function(unitString) {
        return this.toString().toUpperCase() === unitString.toUpperCase();
      };
      Unit.prototype.isLength = function() {
        return Boolean(this.toCSS().match(/px|em|%|in|cm|mm|pc|pt|ex/));
      };
      Unit.prototype.isEmpty = function() {
        return this.numerator.length === 0 && this.denominator.length === 0;
      };
      Unit.prototype.isSingular = function() {
        return this.numerator.length <= 1 && this.denominator.length === 0;
      };
      Unit.prototype.map = function(callback) {
        var i;
        for (i = 0; i < this.numerator.length; i++) {
          this.numerator[i] = callback(this.numerator[i], false);
        }
        for (i = 0; i < this.denominator.length; i++) {
          this.denominator[i] = callback(this.denominator[i], true);
        }
      };
      Unit.prototype.usedUnits = function() {
        var group,
            result = {},
            mapUnit;
        mapUnit = function(atomicUnit) {
          if (group.hasOwnProperty(atomicUnit) && !result[groupName]) {
            result[groupName] = atomicUnit;
          }
          return atomicUnit;
        };
        for (var groupName in unitConversions) {
          if (unitConversions.hasOwnProperty(groupName)) {
            group = unitConversions[groupName];
            this.map(mapUnit);
          }
        }
        return result;
      };
      Unit.prototype.cancel = function() {
        var counter = {},
            atomicUnit,
            i;
        for (i = 0; i < this.numerator.length; i++) {
          atomicUnit = this.numerator[i];
          counter[atomicUnit] = (counter[atomicUnit] || 0) + 1;
        }
        for (i = 0; i < this.denominator.length; i++) {
          atomicUnit = this.denominator[i];
          counter[atomicUnit] = (counter[atomicUnit] || 0) - 1;
        }
        this.numerator = [];
        this.denominator = [];
        for (atomicUnit in counter) {
          if (counter.hasOwnProperty(atomicUnit)) {
            var count = counter[atomicUnit];
            if (count > 0) {
              for (i = 0; i < count; i++) {
                this.numerator.push(atomicUnit);
              }
            } else if (count < 0) {
              for (i = 0; i < -count; i++) {
                this.denominator.push(atomicUnit);
              }
            }
          }
        }
        this.numerator.sort();
        this.denominator.sort();
      };
      module.exports = Unit;
    }, {
      "../data/unit-conversions": 13,
      "./node": 67
    }],
    77: [function(require, module, exports) {
      var Node = require("./node");
      var URL = function(val, index, currentFileInfo, isEvald) {
        this.value = val;
        this.currentFileInfo = currentFileInfo;
        this.index = index;
        this.isEvald = isEvald;
      };
      URL.prototype = new Node();
      URL.prototype.type = "Url";
      URL.prototype.accept = function(visitor) {
        this.value = visitor.visit(this.value);
      };
      URL.prototype.genCSS = function(context, output) {
        output.add("url(");
        this.value.genCSS(context, output);
        output.add(")");
      };
      URL.prototype.eval = function(context) {
        var val = this.value.eval(context),
            rootpath;
        if (!this.isEvald) {
          rootpath = this.currentFileInfo && this.currentFileInfo.rootpath;
          if (rootpath && typeof val.value === "string" && context.isPathRelative(val.value)) {
            if (!val.quote) {
              rootpath = rootpath.replace(/[\(\)'"\s]/g, function(match) {
                return "\\" + match;
              });
            }
            val.value = rootpath + val.value;
          }
          val.value = context.normalizePath(val.value);
          if (context.urlArgs) {
            if (!val.value.match(/^\s*data:/)) {
              var delimiter = val.value.indexOf('?') === -1 ? '?' : '&';
              var urlArgs = delimiter + context.urlArgs;
              if (val.value.indexOf('#') !== -1) {
                val.value = val.value.replace('#', urlArgs + '#');
              } else {
                val.value += urlArgs;
              }
            }
          }
        }
        return new URL(val, this.index, this.currentFileInfo, true);
      };
      module.exports = URL;
    }, {"./node": 67}],
    78: [function(require, module, exports) {
      var Node = require("./node");
      var Value = function(value) {
        this.value = value;
        if (!value) {
          throw new Error("Value requires an array argument");
        }
      };
      Value.prototype = new Node();
      Value.prototype.type = "Value";
      Value.prototype.accept = function(visitor) {
        if (this.value) {
          this.value = visitor.visitArray(this.value);
        }
      };
      Value.prototype.eval = function(context) {
        if (this.value.length === 1) {
          return this.value[0].eval(context);
        } else {
          return new Value(this.value.map(function(v) {
            return v.eval(context);
          }));
        }
      };
      Value.prototype.genCSS = function(context, output) {
        var i;
        for (i = 0; i < this.value.length; i++) {
          this.value[i].genCSS(context, output);
          if (i + 1 < this.value.length) {
            output.add((context && context.compress) ? ',' : ', ');
          }
        }
      };
      module.exports = Value;
    }, {"./node": 67}],
    79: [function(require, module, exports) {
      var Node = require("./node");
      var Variable = function(name, index, currentFileInfo) {
        this.name = name;
        this.index = index;
        this.currentFileInfo = currentFileInfo || {};
      };
      Variable.prototype = new Node();
      Variable.prototype.type = "Variable";
      Variable.prototype.eval = function(context) {
        var variable,
            name = this.name;
        if (name.indexOf('@@') === 0) {
          name = '@' + new Variable(name.slice(1), this.index, this.currentFileInfo).eval(context).value;
        }
        if (this.evaluating) {
          throw {
            type: 'Name',
            message: "Recursive variable definition for " + name,
            filename: this.currentFileInfo.filename,
            index: this.index
          };
        }
        this.evaluating = true;
        variable = this.find(context.frames, function(frame) {
          var v = frame.variable(name);
          if (v) {
            if (v.important) {
              var importantScope = context.importantScope[context.importantScope.length - 1];
              importantScope.important = v.important;
            }
            return v.value.eval(context);
          }
        });
        if (variable) {
          this.evaluating = false;
          return variable;
        } else {
          throw {
            type: 'Name',
            message: "variable " + name + " is undefined",
            filename: this.currentFileInfo.filename,
            index: this.index
          };
        }
      };
      Variable.prototype.find = function(obj, fun) {
        for (var i = 0,
            r; i < obj.length; i++) {
          r = fun.call(obj, obj[i]);
          if (r) {
            return r;
          }
        }
        return null;
      };
      module.exports = Variable;
    }, {"./node": 67}],
    80: [function(require, module, exports) {
      module.exports = {getLocation: function(index, inputStream) {
          var n = index + 1,
              line = null,
              column = -1;
          while (--n >= 0 && inputStream.charAt(n) !== '\n') {
            column++;
          }
          if (typeof index === 'number') {
            line = (inputStream.slice(0, index).match(/\n/g) || "").length;
          }
          return {
            line: line,
            column: column
          };
        }};
    }, {}],
    81: [function(require, module, exports) {
      var tree = require("../tree"),
          Visitor = require("./visitor"),
          logger = require("../logger");
      var ExtendFinderVisitor = function() {
        this._visitor = new Visitor(this);
        this.contexts = [];
        this.allExtendsStack = [[]];
      };
      ExtendFinderVisitor.prototype = {
        run: function(root) {
          root = this._visitor.visit(root);
          root.allExtends = this.allExtendsStack[0];
          return root;
        },
        visitRule: function(ruleNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitMixinDefinition: function(mixinDefinitionNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitRuleset: function(rulesetNode, visitArgs) {
          if (rulesetNode.root) {
            return ;
          }
          var i,
              j,
              extend,
              allSelectorsExtendList = [],
              extendList;
          var rules = rulesetNode.rules,
              ruleCnt = rules ? rules.length : 0;
          for (i = 0; i < ruleCnt; i++) {
            if (rulesetNode.rules[i] instanceof tree.Extend) {
              allSelectorsExtendList.push(rules[i]);
              rulesetNode.extendOnEveryPath = true;
            }
          }
          var paths = rulesetNode.paths;
          for (i = 0; i < paths.length; i++) {
            var selectorPath = paths[i],
                selector = selectorPath[selectorPath.length - 1],
                selExtendList = selector.extendList;
            extendList = selExtendList ? selExtendList.slice(0).concat(allSelectorsExtendList) : allSelectorsExtendList;
            if (extendList) {
              extendList = extendList.map(function(allSelectorsExtend) {
                return allSelectorsExtend.clone();
              });
            }
            for (j = 0; j < extendList.length; j++) {
              this.foundExtends = true;
              extend = extendList[j];
              extend.findSelfSelectors(selectorPath);
              extend.ruleset = rulesetNode;
              if (j === 0) {
                extend.firstExtendOnThisSelectorPath = true;
              }
              this.allExtendsStack[this.allExtendsStack.length - 1].push(extend);
            }
          }
          this.contexts.push(rulesetNode.selectors);
        },
        visitRulesetOut: function(rulesetNode) {
          if (!rulesetNode.root) {
            this.contexts.length = this.contexts.length - 1;
          }
        },
        visitMedia: function(mediaNode, visitArgs) {
          mediaNode.allExtends = [];
          this.allExtendsStack.push(mediaNode.allExtends);
        },
        visitMediaOut: function(mediaNode) {
          this.allExtendsStack.length = this.allExtendsStack.length - 1;
        },
        visitDirective: function(directiveNode, visitArgs) {
          directiveNode.allExtends = [];
          this.allExtendsStack.push(directiveNode.allExtends);
        },
        visitDirectiveOut: function(directiveNode) {
          this.allExtendsStack.length = this.allExtendsStack.length - 1;
        }
      };
      var ProcessExtendsVisitor = function() {
        this._visitor = new Visitor(this);
      };
      ProcessExtendsVisitor.prototype = {
        run: function(root) {
          var extendFinder = new ExtendFinderVisitor();
          this.extendIndicies = {};
          extendFinder.run(root);
          if (!extendFinder.foundExtends) {
            return root;
          }
          root.allExtends = root.allExtends.concat(this.doExtendChaining(root.allExtends, root.allExtends));
          this.allExtendsStack = [root.allExtends];
          var newRoot = this._visitor.visit(root);
          this.checkExtendsForNonMatched(root.allExtends);
          return newRoot;
        },
        checkExtendsForNonMatched: function(extendList) {
          var indicies = this.extendIndicies;
          extendList.filter(function(extend) {
            return !extend.hasFoundMatches && extend.parent_ids.length == 1;
          }).forEach(function(extend) {
            var selector = "_unknown_";
            try {
              selector = extend.selector.toCSS({});
            } catch (_) {}
            if (!indicies[extend.index + ' ' + selector]) {
              indicies[extend.index + ' ' + selector] = true;
              logger.warn("extend '" + selector + "' has no matches");
            }
          });
        },
        doExtendChaining: function(extendsList, extendsListTarget, iterationCount) {
          var extendIndex,
              targetExtendIndex,
              matches,
              extendsToAdd = [],
              newSelector,
              extendVisitor = this,
              selectorPath,
              extend,
              targetExtend,
              newExtend;
          iterationCount = iterationCount || 0;
          for (extendIndex = 0; extendIndex < extendsList.length; extendIndex++) {
            for (targetExtendIndex = 0; targetExtendIndex < extendsListTarget.length; targetExtendIndex++) {
              extend = extendsList[extendIndex];
              targetExtend = extendsListTarget[targetExtendIndex];
              if (extend.parent_ids.indexOf(targetExtend.object_id) >= 0) {
                continue;
              }
              selectorPath = [targetExtend.selfSelectors[0]];
              matches = extendVisitor.findMatch(extend, selectorPath);
              if (matches.length) {
                extend.hasFoundMatches = true;
                extend.selfSelectors.forEach(function(selfSelector) {
                  newSelector = extendVisitor.extendSelector(matches, selectorPath, selfSelector);
                  newExtend = new (tree.Extend)(targetExtend.selector, targetExtend.option, 0);
                  newExtend.selfSelectors = newSelector;
                  newSelector[newSelector.length - 1].extendList = [newExtend];
                  extendsToAdd.push(newExtend);
                  newExtend.ruleset = targetExtend.ruleset;
                  newExtend.parent_ids = newExtend.parent_ids.concat(targetExtend.parent_ids, extend.parent_ids);
                  if (targetExtend.firstExtendOnThisSelectorPath) {
                    newExtend.firstExtendOnThisSelectorPath = true;
                    targetExtend.ruleset.paths.push(newSelector);
                  }
                });
              }
            }
          }
          if (extendsToAdd.length) {
            this.extendChainCount++;
            if (iterationCount > 100) {
              var selectorOne = "{unable to calculate}";
              var selectorTwo = "{unable to calculate}";
              try {
                selectorOne = extendsToAdd[0].selfSelectors[0].toCSS();
                selectorTwo = extendsToAdd[0].selector.toCSS();
              } catch (e) {}
              throw {message: "extend circular reference detected. One of the circular extends is currently:" + selectorOne + ":extend(" + selectorTwo + ")"};
            }
            return extendsToAdd.concat(extendVisitor.doExtendChaining(extendsToAdd, extendsListTarget, iterationCount + 1));
          } else {
            return extendsToAdd;
          }
        },
        visitRule: function(ruleNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitMixinDefinition: function(mixinDefinitionNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitSelector: function(selectorNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitRuleset: function(rulesetNode, visitArgs) {
          if (rulesetNode.root) {
            return ;
          }
          var matches,
              pathIndex,
              extendIndex,
              allExtends = this.allExtendsStack[this.allExtendsStack.length - 1],
              selectorsToAdd = [],
              extendVisitor = this,
              selectorPath;
          for (extendIndex = 0; extendIndex < allExtends.length; extendIndex++) {
            for (pathIndex = 0; pathIndex < rulesetNode.paths.length; pathIndex++) {
              selectorPath = rulesetNode.paths[pathIndex];
              if (rulesetNode.extendOnEveryPath) {
                continue;
              }
              var extendList = selectorPath[selectorPath.length - 1].extendList;
              if (extendList && extendList.length) {
                continue;
              }
              matches = this.findMatch(allExtends[extendIndex], selectorPath);
              if (matches.length) {
                allExtends[extendIndex].hasFoundMatches = true;
                allExtends[extendIndex].selfSelectors.forEach(function(selfSelector) {
                  selectorsToAdd.push(extendVisitor.extendSelector(matches, selectorPath, selfSelector));
                });
              }
            }
          }
          rulesetNode.paths = rulesetNode.paths.concat(selectorsToAdd);
        },
        findMatch: function(extend, haystackSelectorPath) {
          var haystackSelectorIndex,
              hackstackSelector,
              hackstackElementIndex,
              haystackElement,
              targetCombinator,
              i,
              extendVisitor = this,
              needleElements = extend.selector.elements,
              potentialMatches = [],
              potentialMatch,
              matches = [];
          for (haystackSelectorIndex = 0; haystackSelectorIndex < haystackSelectorPath.length; haystackSelectorIndex++) {
            hackstackSelector = haystackSelectorPath[haystackSelectorIndex];
            for (hackstackElementIndex = 0; hackstackElementIndex < hackstackSelector.elements.length; hackstackElementIndex++) {
              haystackElement = hackstackSelector.elements[hackstackElementIndex];
              if (extend.allowBefore || (haystackSelectorIndex === 0 && hackstackElementIndex === 0)) {
                potentialMatches.push({
                  pathIndex: haystackSelectorIndex,
                  index: hackstackElementIndex,
                  matched: 0,
                  initialCombinator: haystackElement.combinator
                });
              }
              for (i = 0; i < potentialMatches.length; i++) {
                potentialMatch = potentialMatches[i];
                targetCombinator = haystackElement.combinator.value;
                if (targetCombinator === '' && hackstackElementIndex === 0) {
                  targetCombinator = ' ';
                }
                if (!extendVisitor.isElementValuesEqual(needleElements[potentialMatch.matched].value, haystackElement.value) || (potentialMatch.matched > 0 && needleElements[potentialMatch.matched].combinator.value !== targetCombinator)) {
                  potentialMatch = null;
                } else {
                  potentialMatch.matched++;
                }
                if (potentialMatch) {
                  potentialMatch.finished = potentialMatch.matched === needleElements.length;
                  if (potentialMatch.finished && (!extend.allowAfter && (hackstackElementIndex + 1 < hackstackSelector.elements.length || haystackSelectorIndex + 1 < haystackSelectorPath.length))) {
                    potentialMatch = null;
                  }
                }
                if (potentialMatch) {
                  if (potentialMatch.finished) {
                    potentialMatch.length = needleElements.length;
                    potentialMatch.endPathIndex = haystackSelectorIndex;
                    potentialMatch.endPathElementIndex = hackstackElementIndex + 1;
                    potentialMatches.length = 0;
                    matches.push(potentialMatch);
                  }
                } else {
                  potentialMatches.splice(i, 1);
                  i--;
                }
              }
            }
          }
          return matches;
        },
        isElementValuesEqual: function(elementValue1, elementValue2) {
          if (typeof elementValue1 === "string" || typeof elementValue2 === "string") {
            return elementValue1 === elementValue2;
          }
          if (elementValue1 instanceof tree.Attribute) {
            if (elementValue1.op !== elementValue2.op || elementValue1.key !== elementValue2.key) {
              return false;
            }
            if (!elementValue1.value || !elementValue2.value) {
              if (elementValue1.value || elementValue2.value) {
                return false;
              }
              return true;
            }
            elementValue1 = elementValue1.value.value || elementValue1.value;
            elementValue2 = elementValue2.value.value || elementValue2.value;
            return elementValue1 === elementValue2;
          }
          elementValue1 = elementValue1.value;
          elementValue2 = elementValue2.value;
          if (elementValue1 instanceof tree.Selector) {
            if (!(elementValue2 instanceof tree.Selector) || elementValue1.elements.length !== elementValue2.elements.length) {
              return false;
            }
            for (var i = 0; i < elementValue1.elements.length; i++) {
              if (elementValue1.elements[i].combinator.value !== elementValue2.elements[i].combinator.value) {
                if (i !== 0 || (elementValue1.elements[i].combinator.value || ' ') !== (elementValue2.elements[i].combinator.value || ' ')) {
                  return false;
                }
              }
              if (!this.isElementValuesEqual(elementValue1.elements[i].value, elementValue2.elements[i].value)) {
                return false;
              }
            }
            return true;
          }
          return false;
        },
        extendSelector: function(matches, selectorPath, replacementSelector) {
          var currentSelectorPathIndex = 0,
              currentSelectorPathElementIndex = 0,
              path = [],
              matchIndex,
              selector,
              firstElement,
              match,
              newElements;
          for (matchIndex = 0; matchIndex < matches.length; matchIndex++) {
            match = matches[matchIndex];
            selector = selectorPath[match.pathIndex];
            firstElement = new tree.Element(match.initialCombinator, replacementSelector.elements[0].value, replacementSelector.elements[0].index, replacementSelector.elements[0].currentFileInfo);
            if (match.pathIndex > currentSelectorPathIndex && currentSelectorPathElementIndex > 0) {
              path[path.length - 1].elements = path[path.length - 1].elements.concat(selectorPath[currentSelectorPathIndex].elements.slice(currentSelectorPathElementIndex));
              currentSelectorPathElementIndex = 0;
              currentSelectorPathIndex++;
            }
            newElements = selector.elements.slice(currentSelectorPathElementIndex, match.index).concat([firstElement]).concat(replacementSelector.elements.slice(1));
            if (currentSelectorPathIndex === match.pathIndex && matchIndex > 0) {
              path[path.length - 1].elements = path[path.length - 1].elements.concat(newElements);
            } else {
              path = path.concat(selectorPath.slice(currentSelectorPathIndex, match.pathIndex));
              path.push(new tree.Selector(newElements));
            }
            currentSelectorPathIndex = match.endPathIndex;
            currentSelectorPathElementIndex = match.endPathElementIndex;
            if (currentSelectorPathElementIndex >= selectorPath[currentSelectorPathIndex].elements.length) {
              currentSelectorPathElementIndex = 0;
              currentSelectorPathIndex++;
            }
          }
          if (currentSelectorPathIndex < selectorPath.length && currentSelectorPathElementIndex > 0) {
            path[path.length - 1].elements = path[path.length - 1].elements.concat(selectorPath[currentSelectorPathIndex].elements.slice(currentSelectorPathElementIndex));
            currentSelectorPathIndex++;
          }
          path = path.concat(selectorPath.slice(currentSelectorPathIndex, selectorPath.length));
          return path;
        },
        visitRulesetOut: function(rulesetNode) {},
        visitMedia: function(mediaNode, visitArgs) {
          var newAllExtends = mediaNode.allExtends.concat(this.allExtendsStack[this.allExtendsStack.length - 1]);
          newAllExtends = newAllExtends.concat(this.doExtendChaining(newAllExtends, mediaNode.allExtends));
          this.allExtendsStack.push(newAllExtends);
        },
        visitMediaOut: function(mediaNode) {
          var lastIndex = this.allExtendsStack.length - 1;
          this.checkExtendsForNonMatched(this.allExtendsStack[lastIndex]);
          this.allExtendsStack.length = lastIndex;
        },
        visitDirective: function(directiveNode, visitArgs) {
          var newAllExtends = directiveNode.allExtends.concat(this.allExtendsStack[this.allExtendsStack.length - 1]);
          newAllExtends = newAllExtends.concat(this.doExtendChaining(newAllExtends, directiveNode.allExtends));
          this.allExtendsStack.push(newAllExtends);
        },
        visitDirectiveOut: function(directiveNode) {
          var lastIndex = this.allExtendsStack.length - 1;
          this.checkExtendsForNonMatched(this.allExtendsStack[lastIndex]);
          this.allExtendsStack.length = lastIndex;
        }
      };
      module.exports = ProcessExtendsVisitor;
    }, {
      "../logger": 31,
      "../tree": 59,
      "./visitor": 87
    }],
    82: [function(require, module, exports) {
      function ImportSequencer(onSequencerEmpty) {
        this.imports = [];
        this.variableImports = [];
        this._onSequencerEmpty = onSequencerEmpty;
        this._currentDepth = 0;
      }
      ImportSequencer.prototype.addImport = function(callback) {
        var importSequencer = this,
            importItem = {
              callback: callback,
              args: null,
              isReady: false
            };
        this.imports.push(importItem);
        return function() {
          importItem.args = Array.prototype.slice.call(arguments, 0);
          importItem.isReady = true;
          importSequencer.tryRun();
        };
      };
      ImportSequencer.prototype.addVariableImport = function(callback) {
        this.variableImports.push(callback);
      };
      ImportSequencer.prototype.tryRun = function() {
        this._currentDepth++;
        try {
          while (true) {
            while (this.imports.length > 0) {
              var importItem = this.imports[0];
              if (!importItem.isReady) {
                return ;
              }
              this.imports = this.imports.slice(1);
              importItem.callback.apply(null, importItem.args);
            }
            if (this.variableImports.length === 0) {
              break;
            }
            var variableImport = this.variableImports[0];
            this.variableImports = this.variableImports.slice(1);
            variableImport();
          }
        } finally {
          this._currentDepth--;
        }
        if (this._currentDepth === 0 && this._onSequencerEmpty) {
          this._onSequencerEmpty();
        }
      };
      module.exports = ImportSequencer;
    }, {}],
    83: [function(require, module, exports) {
      var contexts = require("../contexts"),
          Visitor = require("./visitor"),
          ImportSequencer = require("./import-sequencer");
      var ImportVisitor = function(importer, finish) {
        this._visitor = new Visitor(this);
        this._importer = importer;
        this._finish = finish;
        this.context = new contexts.Eval();
        this.importCount = 0;
        this.onceFileDetectionMap = {};
        this.recursionDetector = {};
        this._sequencer = new ImportSequencer(this._onSequencerEmpty.bind(this));
      };
      ImportVisitor.prototype = {
        isReplacing: false,
        run: function(root) {
          try {
            this._visitor.visit(root);
          } catch (e) {
            this.error = e;
          }
          this.isFinished = true;
          this._sequencer.tryRun();
        },
        _onSequencerEmpty: function() {
          if (!this.isFinished) {
            return ;
          }
          this._finish(this.error);
        },
        visitImport: function(importNode, visitArgs) {
          var inlineCSS = importNode.options.inline;
          if (!importNode.css || inlineCSS) {
            var context = new contexts.Eval(this.context, this.context.frames.slice(0));
            var importParent = context.frames[0];
            this.importCount++;
            if (importNode.isVariableImport()) {
              this._sequencer.addVariableImport(this.processImportNode.bind(this, importNode, context, importParent));
            } else {
              this.processImportNode(importNode, context, importParent);
            }
          }
          visitArgs.visitDeeper = false;
        },
        processImportNode: function(importNode, context, importParent) {
          var evaldImportNode,
              inlineCSS = importNode.options.inline;
          try {
            evaldImportNode = importNode.evalForImport(context);
          } catch (e) {
            if (!e.filename) {
              e.index = importNode.index;
              e.filename = importNode.currentFileInfo.filename;
            }
            importNode.css = true;
            importNode.error = e;
          }
          if (evaldImportNode && (!evaldImportNode.css || inlineCSS)) {
            if (evaldImportNode.options.multiple) {
              context.importMultiple = true;
            }
            var tryAppendLessExtension = evaldImportNode.css === undefined;
            for (var i = 0; i < importParent.rules.length; i++) {
              if (importParent.rules[i] === importNode) {
                importParent.rules[i] = evaldImportNode;
                break;
              }
            }
            var onImported = this.onImported.bind(this, evaldImportNode, context),
                sequencedOnImported = this._sequencer.addImport(onImported);
            this._importer.push(evaldImportNode.getPath(), tryAppendLessExtension, evaldImportNode.currentFileInfo, evaldImportNode.options, sequencedOnImported);
          } else {
            this.importCount--;
            if (this.isFinished) {
              this._sequencer.tryRun();
            }
          }
        },
        onImported: function(importNode, context, e, root, importedAtRoot, fullPath) {
          if (e) {
            if (!e.filename) {
              e.index = importNode.index;
              e.filename = importNode.currentFileInfo.filename;
            }
            this.error = e;
          }
          var importVisitor = this,
              inlineCSS = importNode.options.inline,
              duplicateImport = importedAtRoot || fullPath in importVisitor.recursionDetector;
          if (!context.importMultiple) {
            if (duplicateImport) {
              importNode.skip = true;
            } else {
              importNode.skip = function() {
                if (fullPath in importVisitor.onceFileDetectionMap) {
                  return true;
                }
                importVisitor.onceFileDetectionMap[fullPath] = true;
                return false;
              };
            }
          }
          if (root) {
            importNode.root = root;
            importNode.importedFilename = fullPath;
            if (!inlineCSS && (context.importMultiple || !duplicateImport)) {
              importVisitor.recursionDetector[fullPath] = true;
              var oldContext = this.context;
              this.context = context;
              try {
                this._visitor.visit(root);
              } catch (e) {
                this.error = e;
              }
              this.context = oldContext;
            }
          }
          importVisitor.importCount--;
          if (importVisitor.isFinished) {
            importVisitor._sequencer.tryRun();
          }
        },
        visitRule: function(ruleNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitDirective: function(directiveNode, visitArgs) {
          this.context.frames.unshift(directiveNode);
        },
        visitDirectiveOut: function(directiveNode) {
          this.context.frames.shift();
        },
        visitMixinDefinition: function(mixinDefinitionNode, visitArgs) {
          this.context.frames.unshift(mixinDefinitionNode);
        },
        visitMixinDefinitionOut: function(mixinDefinitionNode) {
          this.context.frames.shift();
        },
        visitRuleset: function(rulesetNode, visitArgs) {
          this.context.frames.unshift(rulesetNode);
        },
        visitRulesetOut: function(rulesetNode) {
          this.context.frames.shift();
        },
        visitMedia: function(mediaNode, visitArgs) {
          this.context.frames.unshift(mediaNode.rules[0]);
        },
        visitMediaOut: function(mediaNode) {
          this.context.frames.shift();
        }
      };
      module.exports = ImportVisitor;
    }, {
      "../contexts": 10,
      "./import-sequencer": 82,
      "./visitor": 87
    }],
    84: [function(require, module, exports) {
      var visitors = {
        Visitor: require("./visitor"),
        ImportVisitor: require('./import-visitor'),
        ExtendVisitor: require('./extend-visitor'),
        JoinSelectorVisitor: require('./join-selector-visitor'),
        ToCSSVisitor: require('./to-css-visitor')
      };
      module.exports = visitors;
    }, {
      "./extend-visitor": 81,
      "./import-visitor": 83,
      "./join-selector-visitor": 85,
      "./to-css-visitor": 86,
      "./visitor": 87
    }],
    85: [function(require, module, exports) {
      var Visitor = require("./visitor");
      var JoinSelectorVisitor = function() {
        this.contexts = [[]];
        this._visitor = new Visitor(this);
      };
      JoinSelectorVisitor.prototype = {
        run: function(root) {
          return this._visitor.visit(root);
        },
        visitRule: function(ruleNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitMixinDefinition: function(mixinDefinitionNode, visitArgs) {
          visitArgs.visitDeeper = false;
        },
        visitRuleset: function(rulesetNode, visitArgs) {
          var context = this.contexts[this.contexts.length - 1],
              paths = [],
              selectors;
          this.contexts.push(paths);
          if (!rulesetNode.root) {
            selectors = rulesetNode.selectors;
            if (selectors) {
              selectors = selectors.filter(function(selector) {
                return selector.getIsOutput();
              });
              rulesetNode.selectors = selectors.length ? selectors : (selectors = null);
              if (selectors) {
                rulesetNode.joinSelectors(paths, context, selectors);
              }
            }
            if (!selectors) {
              rulesetNode.rules = null;
            }
            rulesetNode.paths = paths;
          }
        },
        visitRulesetOut: function(rulesetNode) {
          this.contexts.length = this.contexts.length - 1;
        },
        visitMedia: function(mediaNode, visitArgs) {
          var context = this.contexts[this.contexts.length - 1];
          mediaNode.rules[0].root = (context.length === 0 || context[0].multiMedia);
        }
      };
      module.exports = JoinSelectorVisitor;
    }, {"./visitor": 87}],
    86: [function(require, module, exports) {
      var tree = require("../tree"),
          Visitor = require("./visitor");
      var ToCSSVisitor = function(context) {
        this._visitor = new Visitor(this);
        this._context = context;
      };
      ToCSSVisitor.prototype = {
        isReplacing: true,
        run: function(root) {
          return this._visitor.visit(root);
        },
        visitRule: function(ruleNode, visitArgs) {
          if (ruleNode.variable) {
            return ;
          }
          return ruleNode;
        },
        visitMixinDefinition: function(mixinNode, visitArgs) {
          mixinNode.frames = [];
        },
        visitExtend: function(extendNode, visitArgs) {},
        visitComment: function(commentNode, visitArgs) {
          if (commentNode.isSilent(this._context)) {
            return ;
          }
          return commentNode;
        },
        visitMedia: function(mediaNode, visitArgs) {
          mediaNode.accept(this._visitor);
          visitArgs.visitDeeper = false;
          if (!mediaNode.rules.length) {
            return ;
          }
          return mediaNode;
        },
        visitDirective: function(directiveNode, visitArgs) {
          if (directiveNode.name === "@charset") {
            if (!directiveNode.getIsReferenced()) {
              return ;
            }
            if (this.charset) {
              if (directiveNode.debugInfo) {
                var comment = new tree.Comment("/* " + directiveNode.toCSS(this._context).replace(/\n/g, "") + " */\n");
                comment.debugInfo = directiveNode.debugInfo;
                return this._visitor.visit(comment);
              }
              return ;
            }
            this.charset = true;
          }
          if (directiveNode.rules && directiveNode.rules.rules) {
            this._mergeRules(directiveNode.rules.rules);
            directiveNode.accept(this._visitor);
            visitArgs.visitDeeper = false;
            if (directiveNode.getIsReferenced()) {
              return directiveNode;
            }
            if (!directiveNode.rules.rules) {
              return ;
            }
            for (var r = 0; r < directiveNode.rules.rules.length; r++) {
              var rule = directiveNode.rules.rules[r];
              if (rule.getIsReferenced && rule.getIsReferenced()) {
                directiveNode.markReferenced();
                return directiveNode;
              }
            }
            return ;
          } else {
            if (!directiveNode.getIsReferenced()) {
              return ;
            }
          }
          return directiveNode;
        },
        checkPropertiesInRoot: function(rules) {
          var ruleNode;
          for (var i = 0; i < rules.length; i++) {
            ruleNode = rules[i];
            if (ruleNode instanceof tree.Rule && !ruleNode.variable) {
              throw {
                message: "properties must be inside selector blocks, they cannot be in the root.",
                index: ruleNode.index,
                filename: ruleNode.currentFileInfo ? ruleNode.currentFileInfo.filename : null
              };
            }
          }
        },
        visitRuleset: function(rulesetNode, visitArgs) {
          var rule,
              rulesets = [];
          if (rulesetNode.firstRoot) {
            this.checkPropertiesInRoot(rulesetNode.rules);
          }
          if (!rulesetNode.root) {
            if (rulesetNode.paths) {
              rulesetNode.paths = rulesetNode.paths.filter(function(p) {
                var i;
                if (p[0].elements[0].combinator.value === ' ') {
                  p[0].elements[0].combinator = new (tree.Combinator)('');
                }
                for (i = 0; i < p.length; i++) {
                  if (p[i].getIsReferenced() && p[i].getIsOutput()) {
                    return true;
                  }
                }
                return false;
              });
            }
            var nodeRules = rulesetNode.rules,
                nodeRuleCnt = nodeRules ? nodeRules.length : 0;
            for (var i = 0; i < nodeRuleCnt; ) {
              rule = nodeRules[i];
              if (rule && rule.rules) {
                rulesets.push(this._visitor.visit(rule));
                nodeRules.splice(i, 1);
                nodeRuleCnt--;
                continue;
              }
              i++;
            }
            if (nodeRuleCnt > 0) {
              rulesetNode.accept(this._visitor);
            } else {
              rulesetNode.rules = null;
            }
            visitArgs.visitDeeper = false;
            nodeRules = rulesetNode.rules;
            if (nodeRules) {
              this._mergeRules(nodeRules);
              nodeRules = rulesetNode.rules;
            }
            if (nodeRules) {
              this._removeDuplicateRules(nodeRules);
              nodeRules = rulesetNode.rules;
            }
            if (nodeRules && nodeRules.length > 0 && rulesetNode.paths.length > 0) {
              rulesets.splice(0, 0, rulesetNode);
            }
          } else {
            rulesetNode.accept(this._visitor);
            visitArgs.visitDeeper = false;
            if (rulesetNode.firstRoot || (rulesetNode.rules && rulesetNode.rules.length > 0)) {
              rulesets.splice(0, 0, rulesetNode);
            }
          }
          if (rulesets.length === 1) {
            return rulesets[0];
          }
          return rulesets;
        },
        _removeDuplicateRules: function(rules) {
          if (!rules) {
            return ;
          }
          var ruleCache = {},
              ruleList,
              rule,
              i;
          for (i = rules.length - 1; i >= 0; i--) {
            rule = rules[i];
            if (rule instanceof tree.Rule) {
              if (!ruleCache[rule.name]) {
                ruleCache[rule.name] = rule;
              } else {
                ruleList = ruleCache[rule.name];
                if (ruleList instanceof tree.Rule) {
                  ruleList = ruleCache[rule.name] = [ruleCache[rule.name].toCSS(this._context)];
                }
                var ruleCSS = rule.toCSS(this._context);
                if (ruleList.indexOf(ruleCSS) !== -1) {
                  rules.splice(i, 1);
                } else {
                  ruleList.push(ruleCSS);
                }
              }
            }
          }
        },
        _mergeRules: function(rules) {
          if (!rules) {
            return ;
          }
          var groups = {},
              parts,
              rule,
              key;
          for (var i = 0; i < rules.length; i++) {
            rule = rules[i];
            if ((rule instanceof tree.Rule) && rule.merge) {
              key = [rule.name, rule.important ? "!" : ""].join(",");
              if (!groups[key]) {
                groups[key] = [];
              } else {
                rules.splice(i--, 1);
              }
              groups[key].push(rule);
            }
          }
          Object.keys(groups).map(function(k) {
            function toExpression(values) {
              return new (tree.Expression)(values.map(function(p) {
                return p.value;
              }));
            }
            function toValue(values) {
              return new (tree.Value)(values.map(function(p) {
                return p;
              }));
            }
            parts = groups[k];
            if (parts.length > 1) {
              rule = parts[0];
              var spacedGroups = [];
              var lastSpacedGroup = [];
              parts.map(function(p) {
                if (p.merge === "+") {
                  if (lastSpacedGroup.length > 0) {
                    spacedGroups.push(toExpression(lastSpacedGroup));
                  }
                  lastSpacedGroup = [];
                }
                lastSpacedGroup.push(p);
              });
              spacedGroups.push(toExpression(lastSpacedGroup));
              rule.value = toValue(spacedGroups);
            }
          });
        }
      };
      module.exports = ToCSSVisitor;
    }, {
      "../tree": 59,
      "./visitor": 87
    }],
    87: [function(require, module, exports) {
      var tree = require("../tree");
      var _visitArgs = {visitDeeper: true},
          _hasIndexed = false;
      function _noop(node) {
        return node;
      }
      function indexNodeTypes(parent, ticker) {
        var key,
            child;
        for (key in parent) {
          if (parent.hasOwnProperty(key)) {
            child = parent[key];
            switch (typeof child) {
              case "function":
                if (child.prototype && child.prototype.type) {
                  child.prototype.typeIndex = ticker++;
                }
                break;
              case "object":
                ticker = indexNodeTypes(child, ticker);
                break;
            }
          }
        }
        return ticker;
      }
      var Visitor = function(implementation) {
        this._implementation = implementation;
        this._visitFnCache = [];
        if (!_hasIndexed) {
          indexNodeTypes(tree, 1);
          _hasIndexed = true;
        }
      };
      Visitor.prototype = {
        visit: function(node) {
          if (!node) {
            return node;
          }
          var nodeTypeIndex = node.typeIndex;
          if (!nodeTypeIndex) {
            return node;
          }
          var visitFnCache = this._visitFnCache,
              impl = this._implementation,
              aryIndx = nodeTypeIndex << 1,
              outAryIndex = aryIndx | 1,
              func = visitFnCache[aryIndx],
              funcOut = visitFnCache[outAryIndex],
              visitArgs = _visitArgs,
              fnName;
          visitArgs.visitDeeper = true;
          if (!func) {
            fnName = "visit" + node.type;
            func = impl[fnName] || _noop;
            funcOut = impl[fnName + "Out"] || _noop;
            visitFnCache[aryIndx] = func;
            visitFnCache[outAryIndex] = funcOut;
          }
          if (func !== _noop) {
            var newNode = func.call(impl, node, visitArgs);
            if (impl.isReplacing) {
              node = newNode;
            }
          }
          if (visitArgs.visitDeeper && node && node.accept) {
            node.accept(this);
          }
          if (funcOut != _noop) {
            funcOut.call(impl, node);
          }
          return node;
        },
        visitArray: function(nodes, nonReplacing) {
          if (!nodes) {
            return nodes;
          }
          var cnt = nodes.length,
              i;
          if (nonReplacing || !this._implementation.isReplacing) {
            for (i = 0; i < cnt; i++) {
              this.visit(nodes[i]);
            }
            return nodes;
          }
          var out = [];
          for (i = 0; i < cnt; i++) {
            var evald = this.visit(nodes[i]);
            if (evald === undefined) {
              continue;
            }
            if (!evald.splice) {
              out.push(evald);
            } else if (evald.length) {
              this.flatten(evald, out);
            }
          }
          return out;
        },
        flatten: function(arr, out) {
          if (!out) {
            out = [];
          }
          var cnt,
              i,
              item,
              nestedCnt,
              j,
              nestedItem;
          for (i = 0, cnt = arr.length; i < cnt; i++) {
            item = arr[i];
            if (item === undefined) {
              continue;
            }
            if (!item.splice) {
              out.push(item);
              continue;
            }
            for (j = 0, nestedCnt = item.length; j < nestedCnt; j++) {
              nestedItem = item[j];
              if (nestedItem === undefined) {
                continue;
              }
              if (!nestedItem.splice) {
                out.push(nestedItem);
              } else if (nestedItem.length) {
                this.flatten(nestedItem, out);
              }
            }
          }
          return out;
        }
      };
      module.exports = Visitor;
    }, {"../tree": 59}],
    88: [function(require, module, exports) {
      var process = module.exports = {};
      var queue = [];
      var draining = false;
      function drainQueue() {
        if (draining) {
          return ;
        }
        draining = true;
        var currentQueue;
        var len = queue.length;
        while (len) {
          currentQueue = queue;
          queue = [];
          var i = -1;
          while (++i < len) {
            currentQueue[i]();
          }
          len = queue.length;
        }
        draining = false;
      }
      process.nextTick = function(fun) {
        queue.push(fun);
        if (!draining) {
          setTimeout(drainQueue, 0);
        }
      };
      process.title = 'browser';
      process.browser = true;
      process.env = {};
      process.argv = [];
      process.version = '';
      function noop() {}
      process.on = noop;
      process.addListener = noop;
      process.once = noop;
      process.off = noop;
      process.removeListener = noop;
      process.removeAllListeners = noop;
      process.emit = noop;
      process.binding = function(name) {
        throw new Error('process.binding is not supported');
      };
      process.cwd = function() {
        return '/';
      };
      process.chdir = function(dir) {
        throw new Error('process.chdir is not supported');
      };
      process.umask = function() {
        return 0;
      };
    }, {}],
    89: [function(require, module, exports) {
      'use strict';
      var asap = require('asap');
      module.exports = Promise;
      function Promise(fn) {
        if (typeof this !== 'object')
          throw new TypeError('Promises must be constructed via new');
        if (typeof fn !== 'function')
          throw new TypeError('not a function');
        var state = null;
        var value = null;
        var deferreds = [];
        var self = this;
        this.then = function(onFulfilled, onRejected) {
          return new self.constructor(function(resolve, reject) {
            handle(new Handler(onFulfilled, onRejected, resolve, reject));
          });
        };
        function handle(deferred) {
          if (state === null) {
            deferreds.push(deferred);
            return ;
          }
          asap(function() {
            var cb = state ? deferred.onFulfilled : deferred.onRejected;
            if (cb === null) {
              (state ? deferred.resolve : deferred.reject)(value);
              return ;
            }
            var ret;
            try {
              ret = cb(value);
            } catch (e) {
              deferred.reject(e);
              return ;
            }
            deferred.resolve(ret);
          });
        }
        function resolve(newValue) {
          try {
            if (newValue === self)
              throw new TypeError('A promise cannot be resolved with itself.');
            if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
              var then = newValue.then;
              if (typeof then === 'function') {
                doResolve(then.bind(newValue), resolve, reject);
                return ;
              }
            }
            state = true;
            value = newValue;
            finale();
          } catch (e) {
            reject(e);
          }
        }
        function reject(newValue) {
          state = false;
          value = newValue;
          finale();
        }
        function finale() {
          for (var i = 0,
              len = deferreds.length; i < len; i++)
            handle(deferreds[i]);
          deferreds = null;
        }
        doResolve(fn, resolve, reject);
      }
      function Handler(onFulfilled, onRejected, resolve, reject) {
        this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
        this.onRejected = typeof onRejected === 'function' ? onRejected : null;
        this.resolve = resolve;
        this.reject = reject;
      }
      function doResolve(fn, onFulfilled, onRejected) {
        var done = false;
        try {
          fn(function(value) {
            if (done)
              return ;
            done = true;
            onFulfilled(value);
          }, function(reason) {
            if (done)
              return ;
            done = true;
            onRejected(reason);
          });
        } catch (ex) {
          if (done)
            return ;
          done = true;
          onRejected(ex);
        }
      }
    }, {"asap": 91}],
    90: [function(require, module, exports) {
      'use strict';
      var Promise = require('./core.js');
      var asap = require('asap');
      module.exports = Promise;
      function ValuePromise(value) {
        this.then = function(onFulfilled) {
          if (typeof onFulfilled !== 'function')
            return this;
          return new Promise(function(resolve, reject) {
            asap(function() {
              try {
                resolve(onFulfilled(value));
              } catch (ex) {
                reject(ex);
              }
            });
          });
        };
      }
      ValuePromise.prototype = Promise.prototype;
      var TRUE = new ValuePromise(true);
      var FALSE = new ValuePromise(false);
      var NULL = new ValuePromise(null);
      var UNDEFINED = new ValuePromise(undefined);
      var ZERO = new ValuePromise(0);
      var EMPTYSTRING = new ValuePromise('');
      Promise.resolve = function(value) {
        if (value instanceof Promise)
          return value;
        if (value === null)
          return NULL;
        if (value === undefined)
          return UNDEFINED;
        if (value === true)
          return TRUE;
        if (value === false)
          return FALSE;
        if (value === 0)
          return ZERO;
        if (value === '')
          return EMPTYSTRING;
        if (typeof value === 'object' || typeof value === 'function') {
          try {
            var then = value.then;
            if (typeof then === 'function') {
              return new Promise(then.bind(value));
            }
          } catch (ex) {
            return new Promise(function(resolve, reject) {
              reject(ex);
            });
          }
        }
        return new ValuePromise(value);
      };
      Promise.all = function(arr) {
        var args = Array.prototype.slice.call(arr);
        return new Promise(function(resolve, reject) {
          if (args.length === 0)
            return resolve([]);
          var remaining = args.length;
          function res(i, val) {
            try {
              if (val && (typeof val === 'object' || typeof val === 'function')) {
                var then = val.then;
                if (typeof then === 'function') {
                  then.call(val, function(val) {
                    res(i, val);
                  }, reject);
                  return ;
                }
              }
              args[i] = val;
              if (--remaining === 0) {
                resolve(args);
              }
            } catch (ex) {
              reject(ex);
            }
          }
          for (var i = 0; i < args.length; i++) {
            res(i, args[i]);
          }
        });
      };
      Promise.reject = function(value) {
        return new Promise(function(resolve, reject) {
          reject(value);
        });
      };
      Promise.race = function(values) {
        return new Promise(function(resolve, reject) {
          values.forEach(function(value) {
            Promise.resolve(value).then(resolve, reject);
          });
        });
      };
      Promise.prototype['catch'] = function(onRejected) {
        return this.then(null, onRejected);
      };
    }, {
      "./core.js": 89,
      "asap": 91
    }],
    91: [function(require, module, exports) {
      (function(process) {
        var head = {
          task: void 0,
          next: null
        };
        var tail = head;
        var flushing = false;
        var requestFlush = void 0;
        var isNodeJS = false;
        function flush() {
          while (head.next) {
            head = head.next;
            var task = head.task;
            head.task = void 0;
            var domain = head.domain;
            if (domain) {
              head.domain = void 0;
              domain.enter();
            }
            try {
              task();
            } catch (e) {
              if (isNodeJS) {
                if (domain) {
                  domain.exit();
                }
                setTimeout(flush, 0);
                if (domain) {
                  domain.enter();
                }
                throw e;
              } else {
                setTimeout(function() {
                  throw e;
                }, 0);
              }
            }
            if (domain) {
              domain.exit();
            }
          }
          flushing = false;
        }
        if (typeof process !== "undefined" && process.nextTick) {
          isNodeJS = true;
          requestFlush = function() {
            process.nextTick(flush);
          };
        } else if (typeof setImmediate === "function") {
          if (typeof window !== "undefined") {
            requestFlush = setImmediate.bind(window, flush);
          } else {
            requestFlush = function() {
              setImmediate(flush);
            };
          }
        } else if (typeof MessageChannel !== "undefined") {
          var channel = new MessageChannel();
          channel.port1.onmessage = flush;
          requestFlush = function() {
            channel.port2.postMessage(0);
          };
        } else {
          requestFlush = function() {
            setTimeout(flush, 0);
          };
        }
        function asap(task) {
          tail = tail.next = {
            task: task,
            domain: isNodeJS && process.domain,
            next: null
          };
          if (!flushing) {
            flushing = true;
            requestFlush();
          }
        }
        ;
        module.exports = asap;
      }).call(this, require('_process'));
    }, {"_process": 88}],
    92: [function(require, module, exports) {
      if (typeof Promise.prototype.done !== 'function') {
        Promise.prototype.done = function(onFulfilled, onRejected) {
          var self = arguments.length ? this.then.apply(this, arguments) : this;
          self.then(null, function(err) {
            setTimeout(function() {
              throw err;
            }, 0);
          });
        };
      }
    }, {}],
    "promise/polyfill.js": [function(require, module, exports) {
      var asap = require('asap');
      if (typeof Promise === 'undefined') {
        Promise = require('./lib/core.js');
        require('./lib/es6-extensions.js');
      }
      require('./polyfill-done.js');
    }, {
      "./lib/core.js": 89,
      "./lib/es6-extensions.js": 90,
      "./polyfill-done.js": 92,
      "asap": 91
    }]
  }, {}, [2])(2);
});
})();
System.register("npm:core-js@0.9.18/library/modules/$.fw", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function($) {
    $.FW = false;
    $.path = $.core;
    return $;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.string-at", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$");
  module.exports = function(TO_STRING) {
    return function(that, pos) {
      var s = String($.assertDefined(that)),
          i = $.toInteger(pos),
          l = s.length,
          a,
          b;
      if (i < 0 || i >= l)
        return TO_STRING ? '' : undefined;
      a = s.charCodeAt(i);
      return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.uid", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var sid = 0;
  function uid(key) {
    return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++sid + Math.random()).toString(36));
  }
  uid.safe = require("npm:core-js@0.9.18/library/modules/$").g.Symbol || uid;
  module.exports = uid;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.shared", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      SHARED = '__core-js_shared__',
      store = $.g[SHARED] || ($.g[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.assert", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$");
  function assert(condition, msg1, msg2) {
    if (!condition)
      throw TypeError(msg2 ? msg1 + msg2 : msg1);
  }
  assert.def = $.assertDefined;
  assert.fn = function(it) {
    if (!$.isFunction(it))
      throw TypeError(it + ' is not a function!');
    return it;
  };
  assert.obj = function(it) {
    if (!$.isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  assert.inst = function(it, Constructor, name) {
    if (!(it instanceof Constructor))
      throw TypeError(name + ": use the 'new' operator!");
    return it;
  };
  module.exports = assert;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.def", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      global = $.g,
      core = $.core,
      isFunction = $.isFunction;
  function ctx(fn, that) {
    return function() {
      return fn.apply(that, arguments);
    };
  }
  $def.F = 1;
  $def.G = 2;
  $def.S = 4;
  $def.P = 8;
  $def.B = 16;
  $def.W = 32;
  function $def(type, name, source) {
    var key,
        own,
        out,
        exp,
        isGlobal = type & $def.G,
        isProto = type & $def.P,
        target = isGlobal ? global : type & $def.S ? global[name] : (global[name] || {}).prototype,
        exports = isGlobal ? core : core[name] || (core[name] = {});
    if (isGlobal)
      source = name;
    for (key in source) {
      own = !(type & $def.F) && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      if (isGlobal && !isFunction(target[key]))
        exp = source[key];
      else if (type & $def.B && own)
        exp = ctx(out, global);
      else if (type & $def.W && target[key] == out)
        !function(C) {
          exp = function(param) {
            return this instanceof C ? new C(param) : C(param);
          };
          exp.prototype = C.prototype;
        }(out);
      else
        exp = isProto && isFunction(out) ? ctx(Function.call, out) : out;
      exports[key] = exp;
      if (isProto)
        (exports.prototype || (exports.prototype = {}))[key] = out;
    }
  }
  module.exports = $def;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.redef", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:core-js@0.9.18/library/modules/$").hide;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.ctx", ["npm:core-js@0.9.18/library/modules/$.assert"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var assertFunction = require("npm:core-js@0.9.18/library/modules/$.assert").fn;
  module.exports = function(fn, that, length) {
    assertFunction(fn);
    if (~length && that === undefined)
      return fn;
    switch (length) {
      case 1:
        return function(a) {
          return fn.call(that, a);
        };
      case 2:
        return function(a, b) {
          return fn.call(that, a, b);
        };
      case 3:
        return function(a, b, c) {
          return fn.call(that, a, b, c);
        };
    }
    return function() {
      return fn.apply(that, arguments);
    };
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.iter-call", ["npm:core-js@0.9.18/library/modules/$.assert"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var assertObject = require("npm:core-js@0.9.18/library/modules/$.assert").obj;
  function close(iterator) {
    var ret = iterator['return'];
    if (ret !== undefined)
      assertObject(ret.call(iterator));
  }
  function call(iterator, fn, value, entries) {
    try {
      return entries ? fn(assertObject(value)[0], value[1]) : fn(value);
    } catch (e) {
      close(iterator);
      throw e;
    }
  }
  call.close = close;
  module.exports = call;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.iter-detect", ["npm:core-js@0.9.18/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = require("npm:core-js@0.9.18/library/modules/$.wks")('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][SYMBOL_ITERATOR]();
    riter['return'] = function() {
      SAFE_CLOSING = true;
    };
    Array.from(riter, function() {
      throw 2;
    });
  } catch (e) {}
  module.exports = function(exec) {
    if (!SAFE_CLOSING)
      return false;
    var safe = false;
    try {
      var arr = [7],
          iter = arr[SYMBOL_ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[SYMBOL_ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

System.register("src/mod/sdm", [], false, function(__require, __exports, __module) {
  System.get("@@global-helpers").prepareGlobal(__module.id, []);
  (function() {
    ;
    (function(window, document) {
      "use strict";
      function slice(stuff) {
        return stuff && Array.prototype.slice.call(stuff);
      }
      function type(stuff) {
        return ({}).toString.call(stuff).replace('[object ', '').replace(']', '').toLowerCase();
      }
      var $ = window.$ = function(sel, parent) {
        return (parent || document).querySelector(sel);
      };
      var $$ = window.$$ = function(sel, parent) {
        return slice((parent || document).querySelectorAll(sel));
      };
      function wrapQuotes(val) {
        if (val)
          return '"' + val + '"';
        return val;
      }
      $.id = function(id, parent) {
        return (parent || document).getElementById(id);
      };
      $.cl = function(cl, parent) {
        return $$.cl(cl, parent)[0];
      };
      $.nam = function(nam, parent) {
        return $$.nam(nam, parent)[0];
      };
      $.tag = function(tag, parent) {
        return $$.tag(tag, parent)[0];
      };
      $.attr = function(attr, val, parent) {
        if (typeof val === 'undefined')
          val = '';
        return (parent || document).querySelector('[' + attr + wrapQuotes(val) + ']');
      };
      $.data = function(set, val, parent) {
        return $.attr('data-' + set, val, parent);
      };
      $$.cl = function(cl, parent) {
        return slice((parent || document).getElementsByClassName(cl));
      };
      $$.nam = function(nam, parent) {
        return slice((parent || document).getElementsByName(nam));
      };
      $$.tag = function(tag, parent) {
        return slice((parent || document).getElementsByTagName(tag));
      };
      $$.attr = function(attr, val, parent) {
        if (typeof val === 'undefined')
          val = '';
        return slice((parent || document).querySelectorAll('[' + attr + wrapQuotes(val) + ']'));
      };
      $$.data = function(set, val, parent) {
        return $$.attr('data-' + set, val, parent);
      };
      function assignProps(obj, stuff) {
        if (obj && stuff)
          Object.keys(stuff).forEach(function(key) {
            obj[key] = stuff[key];
          });
      }
      $.apply = function(el, opts) {
        if (!opts)
          return el;
        assignProps(el.style, opts.style);
        delete opts.style;
        assignProps(el.dataset, opts.dataset);
        delete opts.dataset;
        if (opts.classList)
          opts.classList.forEach(function(cl) {
            el.classList.add(cl);
          });
        delete opts.dataset;
        if (opts.childNodes)
          opts.childNodes.forEach(function(child) {
            el.appendChild(child);
          });
        delete opts.childNodes;
        var events = opts.on;
        if (events)
          Object.keys(events).forEach(function(ev) {
            var det = events[ev];
            if (type(det) !== 'array')
              det = [det];
            det.forEach(function(li) {
              var maybeCapture = type(li) === 'array';
              el.addEventListener(ev, maybeCapture ? li[0] : li, maybeCapture ? li[1] : false);
            });
          });
        delete opts.on;
        if (opts.attributes)
          Object.keys(opts.attributes).forEach(function(attr) {
            el.setAttribute(attr, opts.attributes[attr]);
          });
        Object.keys(opts).forEach(function(key) {
          try {
            el[key] = opts[key];
          } catch (e) {}
        });
        return el;
      };
      $.make = function make(sign, opts) {
        if (sign === '#text')
          return document.createTextNode(opts);
        if (sign === '#frag')
          return $.apply(document.createDocumentFragment(), {childNodes: opts && opts.childNodes});
        var el;
        if (typeof sign === 'string') {
          el = document.createElement(sign);
        } else {
          el = sign.cloneNode(opts && opts.deep);
        }
        if (!opts)
          return el;
        delete opts.deep;
        return $.apply(el, opts);
      };
      $.append = function(elem, refElem, position) {
        position = (position || "bottom").toLowerCase();
        if (position === "top") {
          if (!refElem.childNodes.length)
            return refElem.appendChild(elem);
          return refElem.insertBefore(elem, refElem.firstChild);
        } else if (position === "bottom") {
          return refElem.appendChild(elem);
        } else if (position === "before") {
          return refElem.parentNode.insertBefore(elem, refElem);
        } else if (position === "after") {
          if (!refElem.nextElementSibling)
            return refElem.parentNode.appendChild(elem);
          return refElem.parentNode.insertBefore(elem, refElem.nextElementSibling);
        } else if (position === "replace") {
          return refElem.parentNode.replaceChild(elem, refElem);
        } else {
          throw new Error('Unknown position specified. Expected "top", "bottom", "before", "after" or "replace".');
        }
      };
      $.remove = function(node) {
        if (typeof node === 'string')
          node = $(node);
        if (node)
          node.parentNode.removeChild(node);
      };
    })(window, document);
  }).call(System.global);
  return System.get("@@global-helpers").retrieveGlobal(__module.id, false);
});

System.register("npm:core-js@0.9.18/library/modules/es6.object.to-string", ["npm:core-js@0.9.18/library/modules/$.cof", "npm:core-js@0.9.18/library/modules/$.wks", "npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.redef"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var cof = require("npm:core-js@0.9.18/library/modules/$.cof"),
      tmp = {};
  tmp[require("npm:core-js@0.9.18/library/modules/$.wks")('toStringTag')] = 'z';
  if (require("npm:core-js@0.9.18/library/modules/$").FW && cof(tmp) != 'z') {
    require("npm:core-js@0.9.18/library/modules/$.redef")(Object.prototype, 'toString', function toString() {
      return '[object ' + cof.classof(this) + ']';
    }, true);
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.unscope", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.for-of", ["npm:core-js@0.9.18/library/modules/$.ctx", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.iter-call"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var ctx = require("npm:core-js@0.9.18/library/modules/$.ctx"),
      get = require("npm:core-js@0.9.18/library/modules/$.iter").get,
      call = require("npm:core-js@0.9.18/library/modules/$.iter-call");
  module.exports = function(iterable, entries, fn, that) {
    var iterator = get(iterable),
        f = ctx(fn, that, entries ? 2 : 1),
        step;
    while (!(step = iterator.next()).done) {
      if (call(iterator, f, step.value, entries) === false) {
        return call.close(iterator);
      }
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.set-proto", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.assert", "npm:core-js@0.9.18/library/modules/$.ctx"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      assert = require("npm:core-js@0.9.18/library/modules/$.assert");
  function check(O, proto) {
    assert.obj(O);
    assert(proto === null || $.isObject(proto), proto, ": can't set as prototype!");
  }
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(buggy, set) {
      try {
        set = require("npm:core-js@0.9.18/library/modules/$.ctx")(Function.call, $.getDesc(Object.prototype, '__proto__').set, 2);
        set({}, []);
      } catch (e) {
        buggy = true;
      }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy)
          O.__proto__ = proto;
        else
          set(O, proto);
        return O;
      };
    }() : undefined),
    check: check
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.same", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = Object.is || function is(x, y) {
    return x === y ? x !== 0 || 1 / x === 1 / y : x != x && y != y;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.species", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      SPECIES = require("npm:core-js@0.9.18/library/modules/$.wks")('species');
  module.exports = function(C) {
    if ($.DESC && !(SPECIES in C))
      $.setDesc(C, SPECIES, {
        configurable: true,
        get: $.that
      });
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.invoke", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = function(fn, args, that) {
    var un = that === undefined;
    switch (args.length) {
      case 0:
        return un ? fn() : fn.call(that);
      case 1:
        return un ? fn(args[0]) : fn.call(that, args[0]);
      case 2:
        return un ? fn(args[0], args[1]) : fn.call(that, args[0], args[1]);
      case 3:
        return un ? fn(args[0], args[1], args[2]) : fn.call(that, args[0], args[1], args[2]);
      case 4:
        return un ? fn(args[0], args[1], args[2], args[3]) : fn.call(that, args[0], args[1], args[2], args[3]);
      case 5:
        return un ? fn(args[0], args[1], args[2], args[3], args[4]) : fn.call(that, args[0], args[1], args[2], args[3], args[4]);
    }
    return fn.apply(that, args);
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.dom-create", ["npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      document = $.g.document,
      isObject = $.isObject,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:process@0.10.1/browser", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) {
      return ;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      var i = -1;
      while (++i < len) {
        currentQueue[i]();
      }
      len = queue.length;
    }
    draining = false;
  }
  process.nextTick = function(fun) {
    queue.push(fun);
    if (!draining) {
      setTimeout(drainQueue, 0);
    }
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.mix", ["npm:core-js@0.9.18/library/modules/$.redef"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $redef = require("npm:core-js@0.9.18/library/modules/$.redef");
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

(function() {
function define(){};  define.amd = {};
System.register("github:distros/less@2.4.0", ["github:distros/less@2.4.0/less"], false, function(__require, __exports, __module) {
  return (function(main) {
    return main;
  }).call(this, __require('github:distros/less@2.4.0/less'));
});
})();
System.register("npm:core-js@0.9.18/library/modules/$", ["npm:core-js@0.9.18/library/modules/$.fw"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var global = typeof self != 'undefined' ? self : Function('return this')(),
      core = {},
      defineProperty = Object.defineProperty,
      hasOwnProperty = {}.hasOwnProperty,
      ceil = Math.ceil,
      floor = Math.floor,
      max = Math.max,
      min = Math.min;
  var DESC = !!function() {
    try {
      return defineProperty({}, 'a', {get: function() {
          return 2;
        }}).a == 2;
    } catch (e) {}
  }();
  var hide = createDefiner(1);
  function toInteger(it) {
    return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
  }
  function desc(bitmap, value) {
    return {
      enumerable: !(bitmap & 1),
      configurable: !(bitmap & 2),
      writable: !(bitmap & 4),
      value: value
    };
  }
  function simpleSet(object, key, value) {
    object[key] = value;
    return object;
  }
  function createDefiner(bitmap) {
    return DESC ? function(object, key, value) {
      return $.setDesc(object, key, desc(bitmap, value));
    } : simpleSet;
  }
  function isObject(it) {
    return it !== null && (typeof it == 'object' || typeof it == 'function');
  }
  function isFunction(it) {
    return typeof it == 'function';
  }
  function assertDefined(it) {
    if (it == undefined)
      throw TypeError("Can't call method on  " + it);
    return it;
  }
  var $ = module.exports = require("npm:core-js@0.9.18/library/modules/$.fw")({
    g: global,
    core: core,
    html: global.document && document.documentElement,
    isObject: isObject,
    isFunction: isFunction,
    that: function() {
      return this;
    },
    toInteger: toInteger,
    toLength: function(it) {
      return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
    },
    toIndex: function(index, length) {
      index = toInteger(index);
      return index < 0 ? max(index + length, 0) : min(index, length);
    },
    has: function(it, key) {
      return hasOwnProperty.call(it, key);
    },
    create: Object.create,
    getProto: Object.getPrototypeOf,
    DESC: DESC,
    desc: desc,
    getDesc: Object.getOwnPropertyDescriptor,
    setDesc: defineProperty,
    setDescs: Object.defineProperties,
    getKeys: Object.keys,
    getNames: Object.getOwnPropertyNames,
    getSymbols: Object.getOwnPropertySymbols,
    assertDefined: assertDefined,
    ES5Object: Object,
    toObject: function(it) {
      return $.ES5Object(assertDefined(it));
    },
    hide: hide,
    def: createDefiner(0),
    set: global.Symbol ? simpleSet : hide,
    each: [].forEach
  });
  if (typeof __e != 'undefined')
    __e = core;
  if (typeof __g != 'undefined')
    __g = global;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.wks", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.shared", "npm:core-js@0.9.18/library/modules/$.uid"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var global = require("npm:core-js@0.9.18/library/modules/$").g,
      store = require("npm:core-js@0.9.18/library/modules/$.shared")('wks');
  module.exports = function(name) {
    return store[name] || (store[name] = global.Symbol && global.Symbol[name] || require("npm:core-js@0.9.18/library/modules/$.uid").safe('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.iter-define", ["npm:core-js@0.9.18/library/modules/$.def", "npm:core-js@0.9.18/library/modules/$.redef", "npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.cof", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $def = require("npm:core-js@0.9.18/library/modules/$.def"),
      $redef = require("npm:core-js@0.9.18/library/modules/$.redef"),
      $ = require("npm:core-js@0.9.18/library/modules/$"),
      cof = require("npm:core-js@0.9.18/library/modules/$.cof"),
      $iter = require("npm:core-js@0.9.18/library/modules/$.iter"),
      SYMBOL_ITERATOR = require("npm:core-js@0.9.18/library/modules/$.wks")('iterator'),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values',
      Iterators = $iter.Iterators;
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    $iter.create(Constructor, NAME, next);
    function createMethod(kind) {
      function $$(that) {
        return new Constructor(that, kind);
      }
      switch (kind) {
        case KEYS:
          return function keys() {
            return $$(this);
          };
        case VALUES:
          return function values() {
            return $$(this);
          };
      }
      return function entries() {
        return $$(this);
      };
    }
    var TAG = NAME + ' Iterator',
        proto = Base.prototype,
        _native = proto[SYMBOL_ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        _default = _native || createMethod(DEFAULT),
        methods,
        key;
    if (_native) {
      var IteratorPrototype = $.getProto(_default.call(new Base));
      cof.set(IteratorPrototype, TAG, true);
      if ($.FW && $.has(proto, FF_ITERATOR))
        $iter.set(IteratorPrototype, $.that);
    }
    if ($.FW || FORCE)
      $iter.set(proto, _default);
    Iterators[NAME] = _default;
    Iterators[TAG] = $.that;
    if (DEFAULT) {
      methods = {
        keys: IS_SET ? _default : createMethod(KEYS),
        values: DEFAULT == VALUES ? _default : createMethod(VALUES),
        entries: DEFAULT != VALUES ? _default : createMethod('entries')
      };
      if (FORCE)
        for (key in methods) {
          if (!(key in proto))
            $redef(proto, key, methods[key]);
        }
      else
        $def($def.P + $def.F * $iter.BUGGY, NAME, methods);
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/es6.array.from", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.ctx", "npm:core-js@0.9.18/library/modules/$.def", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.iter-call", "npm:core-js@0.9.18/library/modules/$.iter-detect"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      ctx = require("npm:core-js@0.9.18/library/modules/$.ctx"),
      $def = require("npm:core-js@0.9.18/library/modules/$.def"),
      $iter = require("npm:core-js@0.9.18/library/modules/$.iter"),
      call = require("npm:core-js@0.9.18/library/modules/$.iter-call");
  $def($def.S + $def.F * !require("npm:core-js@0.9.18/library/modules/$.iter-detect")(function(iter) {
    Array.from(iter);
  }), 'Array', {from: function from(arrayLike) {
      var O = Object($.assertDefined(arrayLike)),
          mapfn = arguments[1],
          mapping = mapfn !== undefined,
          f = mapping ? ctx(mapfn, arguments[2], 2) : undefined,
          index = 0,
          length,
          result,
          step,
          iterator;
      if ($iter.is(O)) {
        iterator = $iter.get(O);
        result = new (typeof this == 'function' ? this : Array);
        for (; !(step = iterator.next()).done; index++) {
          result[index] = mapping ? call(iterator, f, [step.value, index], true) : step.value;
        }
      } else {
        result = new (typeof this == 'function' ? this : Array)(length = $.toLength(O.length));
        for (; length > index; index++) {
          result[index] = mapping ? f(O[index], index) : O[index];
        }
      }
      result.length = index;
      return result;
    }});
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/es6.array.iterator", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.unscope", "npm:core-js@0.9.18/library/modules/$.uid", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.iter-define"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      setUnscope = require("npm:core-js@0.9.18/library/modules/$.unscope"),
      ITER = require("npm:core-js@0.9.18/library/modules/$.uid").safe('iter'),
      $iter = require("npm:core-js@0.9.18/library/modules/$.iter"),
      step = $iter.step,
      Iterators = $iter.Iterators;
  require("npm:core-js@0.9.18/library/modules/$.iter-define")(Array, 'Array', function(iterated, kind) {
    $.set(this, ITER, {
      o: $.toObject(iterated),
      i: 0,
      k: kind
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        kind = iter.k,
        index = iter.i++;
    if (!O || index >= O.length) {
      iter.o = undefined;
      return step(1);
    }
    if (kind == 'keys')
      return step(0, index);
    if (kind == 'values')
      return step(0, O[index]);
    return step(0, [index, O[index]]);
  }, 'values');
  Iterators.Arguments = Iterators.Array;
  setUnscope('keys');
  setUnscope('values');
  setUnscope('entries');
  global.define = __define;
  return module.exports;
});

System.register("npm:process@0.10.1", ["npm:process@0.10.1/browser"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:process@0.10.1/browser");
  global.define = __define;
  return module.exports;
});

System.register("github:aaike/jspm-less-plugin@0.0.5/less", ["github:distros/less@2.4.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var less = require("github:distros/less@2.4.0");
  if (typeof window !== 'undefined') {
    var head = document.getElementsByTagName('head')[0];
    var styles = document.getElementsByTagName('style');
    var styleIds = [];
    for (var i = 0; i < styles.length; i++) {
      if (!styles[i].hasAttribute("data-href"))
        continue;
      styleIds.push(styles[i].getAttribute("data-href"));
    }
    var loadStyle = function(url) {
      return new Promise(function(resolve, reject) {
        var request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.onload = function() {
          if (request.status >= 200 && request.status < 400) {
            var data = request.responseText;
            less.render(data, {
              filename: url,
              rootpath: url.replace(/[^\/]*$/, '')
            }).then(function(data) {
              var style = document.createElement('style');
              style.textContent = data.css;
              style.setAttribute('type', 'text/css');
              style.setAttribute('data-type', 'text/less');
              style.setAttribute('data-href', url);
              head.appendChild(style);
              resolve('');
            });
          } else {
            reject();
          }
        };
        request.onerror = function(e) {
          reject(e);
        };
        request.send();
      });
    };
    exports.fetch = function(load) {
      for (var i = 0; i < styleIds.length; i++)
        if (load.address == styleIds[i])
          return '';
      return loadStyle(load.address);
    };
  } else {
    exports.translate = function(load) {
      load.metadata.format = 'defined';
    };
    exports.bundle = function(loads, opts) {
      var loader = this;
      if (loader.buildCSS === false)
        return '';
      return loader.import('./less-builder', {name: module.id}).then(function(builder) {
        return builder.call(loader, loads, opts);
      });
    };
  }
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.cof", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      TAG = require("npm:core-js@0.9.18/library/modules/$.wks")('toStringTag'),
      toString = {}.toString;
  function cof(it) {
    return toString.call(it).slice(8, -1);
  }
  cof.classof = function(it) {
    var O,
        T;
    return it == undefined ? it === undefined ? 'Undefined' : 'Null' : typeof(T = (O = Object(it))[TAG]) == 'string' ? T : cof(O);
  };
  cof.set = function(it, tag, stat) {
    if (it && !$.has(it = stat ? it : it.prototype, TAG))
      $.hide(it, TAG, tag);
  };
  module.exports = cof;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/web.dom.iterable", ["npm:core-js@0.9.18/library/modules/es6.array.iterator", "npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.wks"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.18/library/modules/es6.array.iterator");
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      Iterators = require("npm:core-js@0.9.18/library/modules/$.iter").Iterators,
      ITERATOR = require("npm:core-js@0.9.18/library/modules/$.wks")('iterator'),
      ArrayValues = Iterators.Array,
      NL = $.g.NodeList,
      HTC = $.g.HTMLCollection,
      NLProto = NL && NL.prototype,
      HTCProto = HTC && HTC.prototype;
  if ($.FW) {
    if (NL && !(ITERATOR in NLProto))
      $.hide(NLProto, ITERATOR, ArrayValues);
    if (HTC && !(ITERATOR in HTCProto))
      $.hide(HTCProto, ITERATOR, ArrayValues);
  }
  Iterators.NodeList = Iterators.HTMLCollection = ArrayValues;
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-process@0.1.1/index", ["npm:process@0.10.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = System._nodeRequire ? process : require("npm:process@0.10.1");
  global.define = __define;
  return module.exports;
});

System.register("github:aaike/jspm-less-plugin@0.0.5", ["github:aaike/jspm-less-plugin@0.0.5/less"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:aaike/jspm-less-plugin@0.0.5/less");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.iter", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.cof", "npm:core-js@0.9.18/library/modules/$.assert", "npm:core-js@0.9.18/library/modules/$.wks", "npm:core-js@0.9.18/library/modules/$.shared"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = require("npm:core-js@0.9.18/library/modules/$"),
      cof = require("npm:core-js@0.9.18/library/modules/$.cof"),
      classof = cof.classof,
      assert = require("npm:core-js@0.9.18/library/modules/$.assert"),
      assertObject = assert.obj,
      SYMBOL_ITERATOR = require("npm:core-js@0.9.18/library/modules/$.wks")('iterator'),
      FF_ITERATOR = '@@iterator',
      Iterators = require("npm:core-js@0.9.18/library/modules/$.shared")('iterators'),
      IteratorPrototype = {};
  setIterator(IteratorPrototype, $.that);
  function setIterator(O, value) {
    $.hide(O, SYMBOL_ITERATOR, value);
    if (FF_ITERATOR in [])
      $.hide(O, FF_ITERATOR, value);
  }
  module.exports = {
    BUGGY: 'keys' in [] && !('next' in [].keys()),
    Iterators: Iterators,
    step: function(done, value) {
      return {
        value: value,
        done: !!done
      };
    },
    is: function(it) {
      var O = Object(it),
          Symbol = $.g.Symbol;
      return (Symbol && Symbol.iterator || FF_ITERATOR) in O || SYMBOL_ITERATOR in O || $.has(Iterators, classof(O));
    },
    get: function(it) {
      var Symbol = $.g.Symbol,
          getIter;
      if (it != undefined) {
        getIter = it[Symbol && Symbol.iterator || FF_ITERATOR] || it[SYMBOL_ITERATOR] || Iterators[classof(it)];
      }
      assert($.isFunction(getIter), it, ' is not iterable!');
      return assertObject(getIter.call(it));
    },
    set: setIterator,
    create: function(Constructor, NAME, next, proto) {
      Constructor.prototype = $.create(proto || IteratorPrototype, {next: $.desc(1, next)});
      cof.set(Constructor, NAME + ' Iterator');
    }
  };
  global.define = __define;
  return module.exports;
});

System.register("github:jspm/nodelibs-process@0.1.1", ["github:jspm/nodelibs-process@0.1.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:jspm/nodelibs-process@0.1.1/index");
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/es6.string.iterator", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.string-at", "npm:core-js@0.9.18/library/modules/$.uid", "npm:core-js@0.9.18/library/modules/$.iter", "npm:core-js@0.9.18/library/modules/$.iter-define"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var set = require("npm:core-js@0.9.18/library/modules/$").set,
      $at = require("npm:core-js@0.9.18/library/modules/$.string-at")(true),
      ITER = require("npm:core-js@0.9.18/library/modules/$.uid").safe('iter'),
      $iter = require("npm:core-js@0.9.18/library/modules/$.iter"),
      step = $iter.step;
  require("npm:core-js@0.9.18/library/modules/$.iter-define")(String, 'String', function(iterated) {
    set(this, ITER, {
      o: String(iterated),
      i: 0
    });
  }, function() {
    var iter = this[ITER],
        O = iter.o,
        index = iter.i,
        point;
    if (index >= O.length)
      return step(1);
    point = $at(O, index);
    iter.i += point.length;
    return step(0, point);
  });
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/$.task", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.ctx", "npm:core-js@0.9.18/library/modules/$.cof", "npm:core-js@0.9.18/library/modules/$.invoke", "npm:core-js@0.9.18/library/modules/$.dom-create", "github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("npm:core-js@0.9.18/library/modules/$"),
        ctx = require("npm:core-js@0.9.18/library/modules/$.ctx"),
        cof = require("npm:core-js@0.9.18/library/modules/$.cof"),
        invoke = require("npm:core-js@0.9.18/library/modules/$.invoke"),
        cel = require("npm:core-js@0.9.18/library/modules/$.dom-create"),
        global = $.g,
        isFunction = $.isFunction,
        html = $.html,
        process = global.process,
        setTask = global.setImmediate,
        clearTask = global.clearImmediate,
        MessageChannel = global.MessageChannel,
        counter = 0,
        queue = {},
        ONREADYSTATECHANGE = 'onreadystatechange',
        defer,
        channel,
        port;
    function run() {
      var id = +this;
      if ($.has(queue, id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    }
    function listner(event) {
      run.call(event.data);
    }
    if (!isFunction(setTask) || !isFunction(clearTask)) {
      setTask = function(fn) {
        var args = [],
            i = 1;
        while (arguments.length > i)
          args.push(arguments[i++]);
        queue[++counter] = function() {
          invoke(isFunction(fn) ? fn : Function(fn), args);
        };
        defer(counter);
        return counter;
      };
      clearTask = function(id) {
        delete queue[id];
      };
      if (cof(process) == 'process') {
        defer = function(id) {
          process.nextTick(ctx(run, id, 1));
        };
      } else if (global.addEventListener && isFunction(global.postMessage) && !global.importScripts) {
        defer = function(id) {
          global.postMessage(id, '*');
        };
        global.addEventListener('message', listner, false);
      } else if (isFunction(MessageChannel)) {
        channel = new MessageChannel;
        port = channel.port2;
        channel.port1.onmessage = listner;
        defer = ctx(port.postMessage, port, 1);
      } else if (ONREADYSTATECHANGE in cel('script')) {
        defer = function(id) {
          html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run.call(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(ctx(run, id, 1), 0);
        };
      }
    }
    module.exports = {
      set: setTask,
      clear: clearTask
    };
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/fn/array/from", ["npm:core-js@0.9.18/library/modules/es6.string.iterator", "npm:core-js@0.9.18/library/modules/es6.array.from", "npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.18/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.18/library/modules/es6.array.from");
  module.exports = require("npm:core-js@0.9.18/library/modules/$").core.Array.from;
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/modules/es6.promise", ["npm:core-js@0.9.18/library/modules/$", "npm:core-js@0.9.18/library/modules/$.ctx", "npm:core-js@0.9.18/library/modules/$.cof", "npm:core-js@0.9.18/library/modules/$.def", "npm:core-js@0.9.18/library/modules/$.assert", "npm:core-js@0.9.18/library/modules/$.for-of", "npm:core-js@0.9.18/library/modules/$.set-proto", "npm:core-js@0.9.18/library/modules/$.same", "npm:core-js@0.9.18/library/modules/$.species", "npm:core-js@0.9.18/library/modules/$.wks", "npm:core-js@0.9.18/library/modules/$.uid", "npm:core-js@0.9.18/library/modules/$.task", "npm:core-js@0.9.18/library/modules/$.mix", "npm:core-js@0.9.18/library/modules/$.iter-detect", "github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = require("npm:core-js@0.9.18/library/modules/$"),
        ctx = require("npm:core-js@0.9.18/library/modules/$.ctx"),
        cof = require("npm:core-js@0.9.18/library/modules/$.cof"),
        $def = require("npm:core-js@0.9.18/library/modules/$.def"),
        assert = require("npm:core-js@0.9.18/library/modules/$.assert"),
        forOf = require("npm:core-js@0.9.18/library/modules/$.for-of"),
        setProto = require("npm:core-js@0.9.18/library/modules/$.set-proto").set,
        same = require("npm:core-js@0.9.18/library/modules/$.same"),
        species = require("npm:core-js@0.9.18/library/modules/$.species"),
        SPECIES = require("npm:core-js@0.9.18/library/modules/$.wks")('species'),
        RECORD = require("npm:core-js@0.9.18/library/modules/$.uid").safe('record'),
        PROMISE = 'Promise',
        global = $.g,
        process = global.process,
        isNode = cof(process) == 'process',
        asap = process && process.nextTick || require("npm:core-js@0.9.18/library/modules/$.task").set,
        P = global[PROMISE],
        isFunction = $.isFunction,
        isObject = $.isObject,
        assertFunction = assert.fn,
        assertObject = assert.obj,
        Wrapper;
    function testResolve(sub) {
      var test = new P(function() {});
      if (sub)
        test.constructor = Object;
      return P.resolve(test) === test;
    }
    var useNative = function() {
      var works = false;
      function P2(x) {
        var self = new P(x);
        setProto(self, P2.prototype);
        return self;
      }
      try {
        works = isFunction(P) && isFunction(P.resolve) && testResolve();
        setProto(P2, P);
        P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
        if (!(P2.resolve(5).then(function() {}) instanceof P2)) {
          works = false;
        }
        if (works && $.DESC) {
          var thenableThenGotten = false;
          P.resolve($.setDesc({}, 'then', {get: function() {
              thenableThenGotten = true;
            }}));
          works = thenableThenGotten;
        }
      } catch (e) {
        works = false;
      }
      return works;
    }();
    function isPromise(it) {
      return isObject(it) && (useNative ? cof.classof(it) == 'Promise' : RECORD in it);
    }
    function sameConstructor(a, b) {
      if (!$.FW && a === P && b === Wrapper)
        return true;
      return same(a, b);
    }
    function getConstructor(C) {
      var S = assertObject(C)[SPECIES];
      return S != undefined ? S : C;
    }
    function isThenable(it) {
      var then;
      if (isObject(it))
        then = it.then;
      return isFunction(then) ? then : false;
    }
    function notify(record) {
      var chain = record.c;
      if (chain.length)
        asap.call(global, function() {
          var value = record.v,
              ok = record.s == 1,
              i = 0;
          function run(react) {
            var cb = ok ? react.ok : react.fail,
                ret,
                then;
            try {
              if (cb) {
                if (!ok)
                  record.h = true;
                ret = cb === true ? value : cb(value);
                if (ret === react.P) {
                  react.rej(TypeError('Promise-chain cycle'));
                } else if (then = isThenable(ret)) {
                  then.call(ret, react.res, react.rej);
                } else
                  react.res(ret);
              } else
                react.rej(value);
            } catch (err) {
              react.rej(err);
            }
          }
          while (chain.length > i)
            run(chain[i++]);
          chain.length = 0;
        });
    }
    function isUnhandled(promise) {
      var record = promise[RECORD],
          chain = record.a || record.c,
          i = 0,
          react;
      if (record.h)
        return false;
      while (chain.length > i) {
        react = chain[i++];
        if (react.fail || !isUnhandled(react.P))
          return false;
      }
      return true;
    }
    function $reject(value) {
      var record = this,
          promise;
      if (record.d)
        return ;
      record.d = true;
      record = record.r || record;
      record.v = value;
      record.s = 2;
      record.a = record.c.slice();
      setTimeout(function() {
        asap.call(global, function() {
          if (isUnhandled(promise = record.p)) {
            if (isNode) {
              process.emit('unhandledRejection', value, promise);
            } else if (global.console && console.error) {
              console.error('Unhandled promise rejection', value);
            }
          }
          record.a = undefined;
        });
      }, 1);
      notify(record);
    }
    function $resolve(value) {
      var record = this,
          then;
      if (record.d)
        return ;
      record.d = true;
      record = record.r || record;
      try {
        if (then = isThenable(value)) {
          asap.call(global, function() {
            var wrapper = {
              r: record,
              d: false
            };
            try {
              then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
            } catch (e) {
              $reject.call(wrapper, e);
            }
          });
        } else {
          record.v = value;
          record.s = 1;
          notify(record);
        }
      } catch (e) {
        $reject.call({
          r: record,
          d: false
        }, e);
      }
    }
    if (!useNative) {
      P = function Promise(executor) {
        assertFunction(executor);
        var record = {
          p: assert.inst(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false
        };
        $.hide(this, RECORD, record);
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      require("npm:core-js@0.9.18/library/modules/$.mix")(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var S = assertObject(assertObject(this).constructor)[SPECIES];
          var react = {
            ok: isFunction(onFulfilled) ? onFulfilled : true,
            fail: isFunction(onRejected) ? onRejected : false
          };
          var promise = react.P = new (S != undefined ? S : P)(function(res, rej) {
            react.res = assertFunction(res);
            react.rej = assertFunction(rej);
          });
          var record = this[RECORD];
          record.c.push(react);
          if (record.a)
            record.a.push(react);
          if (record.s)
            notify(record);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $def($def.G + $def.W + $def.F * !useNative, {Promise: P});
    cof.set(P, PROMISE);
    species(P);
    species(Wrapper = $.core[PROMISE]);
    $def($def.S + $def.F * !useNative, PROMISE, {reject: function reject(r) {
        return new (getConstructor(this))(function(res, rej) {
          rej(r);
        });
      }});
    $def($def.S + $def.F * (!useNative || testResolve(true)), PROMISE, {resolve: function resolve(x) {
        return isPromise(x) && sameConstructor(x.constructor, this) ? x : new this(function(res) {
          res(x);
        });
      }});
    $def($def.S + $def.F * !(useNative && require("npm:core-js@0.9.18/library/modules/$.iter-detect")(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            values = [];
        return new C(function(res, rej) {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              C.resolve(promise).then(function(value) {
                results[index] = value;
                --remaining || res(results);
              }, rej);
            });
          else
            res(results);
        });
      },
      race: function race(iterable) {
        var C = getConstructor(this);
        return new C(function(res, rej) {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(res, rej);
          });
        });
      }
    });
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.5.8/core-js/array/from", ["npm:core-js@0.9.18/library/fn/array/from"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.18/library/fn/array/from"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register("npm:core-js@0.9.18/library/fn/promise", ["npm:core-js@0.9.18/library/modules/es6.object.to-string", "npm:core-js@0.9.18/library/modules/es6.string.iterator", "npm:core-js@0.9.18/library/modules/web.dom.iterable", "npm:core-js@0.9.18/library/modules/es6.promise", "npm:core-js@0.9.18/library/modules/$"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  require("npm:core-js@0.9.18/library/modules/es6.object.to-string");
  require("npm:core-js@0.9.18/library/modules/es6.string.iterator");
  require("npm:core-js@0.9.18/library/modules/web.dom.iterable");
  require("npm:core-js@0.9.18/library/modules/es6.promise");
  module.exports = require("npm:core-js@0.9.18/library/modules/$").core.Promise;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.5.8/helpers/to-consumable-array", ["npm:babel-runtime@5.5.8/core-js/array/from"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Array$from = require("npm:babel-runtime@5.5.8/core-js/array/from")["default"];
  exports["default"] = function(arr) {
    if (Array.isArray(arr)) {
      for (var i = 0,
          arr2 = Array(arr.length); i < arr.length; i++)
        arr2[i] = arr[i];
      return arr2;
    } else {
      return _Array$from(arr);
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

System.register("npm:babel-runtime@5.5.8/core-js/promise", ["npm:core-js@0.9.18/library/fn/promise"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": require("npm:core-js@0.9.18/library/fn/promise"),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

System.register('src/mod/utils', ['npm:babel-runtime@5.5.8/core-js/promise'], function (_export) {
  var _Promise, re;

  function frag(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var frag = doc.createDocumentFragment();
    var body = doc.body;
    while (body.firstChild) {
      frag.appendChild(body.firstChild);
    }
    return frag;
  }

  function throttle(fn, time, thisArg, repeatAction) {

    var lastRun = false;
    var nextTime = 0;

    return function throttled() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      var now = Date.now();
      return new _Promise(function (resolve) {
        if (!lastRun) {
          lastRun = now;
          return resolve(fn.apply(thisArg, args));
        }
        if (now - lastRun <= time) {
          if (repeatAction === 'discard-repeats') return;
          nextTime += time - (now - lastRun);
          return setTimeout(function () {
            lastRun = Date.now();
            return resolve(fn.apply(thisArg, args));
          }, nextTime);
        }
        lastRun = now;
        return resolve(fn.apply(thisArg, args));
      });
    };
  }

  return {
    setters: [function (_npmBabelRuntime558CoreJsPromise) {
      _Promise = _npmBabelRuntime558CoreJsPromise['default'];
    }],
    execute: function () {
      'use strict';

      _export('frag', frag);

      _export('throttle', throttle);

      re = {
        escape: function RegexpEscape(s) {
          return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
        }
      };

      _export('re', re);
    }
  };
});
System.register('src/mod/domconsole', [], function (_export) {
	'use strict';

	var c, domconsole;
	return {
		setters: [],
		execute: function () {
			c = $.id('console');
			domconsole = {
				log: function log() {
					for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
						args[_key] = arguments[_key];
					}

					c.style.color = '';
					c.textContent = args.join(' ');
				},
				error: function error() {
					for (var _len2 = arguments.length, args = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
						args[_key2] = arguments[_key2];
					}

					c.style.color = 'red';
					c.textContent = args.join(' ');
				},
				clear: function clear() {
					c.style.color = '';
					c.textContent = '';
				}
			};

			_export('domconsole', domconsole);
		}
	};
});
System.register('src/mod/shortcuts', ['npm:babel-runtime@5.5.8/helpers/to-consumable-array'], function (_export) {
	var _toConsumableArray, shortcuts, Key_Mappings;

	function handler(ev) {
		var mods = [];
		if (ev.altKey) mods.push('alt');
		if (ev.ctrlKey) mods.push('ctrl');
		if (ev.shiftKey) mods.push('shift');
		mods = mods.sort();
		var keyCode = ev.keyCode;
		var id = '' + mods.join('+') + ':' + keyCode;

		if (shortcuts[ev.type].hasOwnProperty(id)) {
			var _shortcuts$ev$type$id = shortcuts[ev.type][id];
			var callback = _shortcuts$ev$type$id.callback;
			var thisArg = _shortcuts$ev$type$id.thisArg;
			var args = _shortcuts$ev$type$id.args;

			callback.call.apply(callback, [thisArg, ev].concat(_toConsumableArray(args)));
		}
	}

	function findKeyCode(key) {
		return Key_Mappings[key.toUpperCase()];
	}

	function parseKey(_ref) {
		var _ref$modifier = _ref.modifier;
		var modifier = _ref$modifier === undefined ? [] : _ref$modifier;
		var _ref$key = _ref.key;
		var key = _ref$key === undefined ? '' : _ref$key;

		if (!Array.isArray(modifier)) modifier = [modifier];
		var mods = modifier.map(function (m) {
			return m.toLowerCase();
		}).sort();
		var evType = undefined,
		    keyCode = undefined;
		if (!modifier.length && String(key).length === 1) {
			evType = 'keypress';
			keyCode = key.toLowerCase().charCodeAt();
		} else {
			evType = 'keydown';
			keyCode = key;
			if (!Number(key)) {
				keyCode = findKeyCode(key);
			}
		}
		if (!keyCode) throw new Error('Unable to parse key definition. Passed modifier: ' + modifier + '. Passed Key: ' + key + '.');
		var id = '' + mods.join('+') + ':' + keyCode;
		return { mods: mods, id: id, keyCode: keyCode, evType: evType, key: key };
	}

	function register(definition, callback, thisArg) {
		for (var _len = arguments.length, args = Array(_len > 3 ? _len - 3 : 0), _key = 3; _key < _len; _key++) {
			args[_key - 3] = arguments[_key];
		}

		var descriptor = parseKey(definition);
		var data = { callback: callback, thisArg: thisArg, args: args };
		shortcuts[descriptor.evType][descriptor.id] = data;
	}

	function remove(definition) {
		var _parseKey = parseKey(definition);

		var evType = _parseKey.evType;
		var id = _parseKey.id;

		delete shortcuts[evType][id];
	}

	function removeAll() {
		shortcuts = {
			keypress: {},
			keydown: {}
		};
	}

	return {
		setters: [function (_npmBabelRuntime558HelpersToConsumableArray) {
			_toConsumableArray = _npmBabelRuntime558HelpersToConsumableArray['default'];
		}],
		execute: function () {
			'use strict';

			_export('register', register);

			_export('remove', remove);

			_export('removeAll', removeAll);

			shortcuts = {
				keypress: {},
				keydown: {}
			};
			Key_Mappings = {
				F: 70,
				P: 80,
				ESC: 27
			};

			document.addEventListener('keypress', handler, true);
			document.addEventListener('keydown', handler, true);
		}
	};
});
System.register('src/spec', ['npm:babel-runtime@5.5.8/core-js/promise', 'src/mod/utils', 'src/mod/domconsole'], function (_export) {
	var _Promise, Utils, domconsole, Store, Data, SPEC_URL, MAX_RESULTS;

	function indexToPath(index) {
		var pathNums = index.split('.');
		return pathNums.map(function (num) {
			return Data.stack[Data.indexToFrameIndex[num]].title;
		}).join(' | ');
	}

	function indexToFrame(index) {
		try {
			return Data.stack[Data.indexToFrameIndex[index]];
		} catch (err) {
			return null;
		}
	}

	//=================================================================================================
	// functions to scrape spec

	function fetchSpec() {
		var url = arguments[0] === undefined ? SPEC_URL : arguments[0];

		console.log('sending request to %s', url);
		var f = fetch(url).then(function (res) {
			return res.text();
		}).then(function (html) {
			return new DOMParser().parseFromString(html, 'text/html');
		});
		return f;
	}

	// replaces multiple simultaneous whitespace characters with single space
	function normalize(string) {
		return string.replace(/(?:\n+|\s+)/g, ' ');
	}

	// *internal* takes list element, secnum (whatever) and extracts a title value
	function extractText(el, secnum) {
		var c = $.cl('toc', el);
		var title = '';
		var nextEl = secnum.nextSibling;
		while (nextEl && nextEl.nodeName.toLowerCase() !== 'ol') {
			title += nextEl.textContent;
			nextEl = nextEl.nextSibling;
		}
		return normalize(title.trim());
	}

	function parseIndex(doc) {
		var elements = $$('span.secnum[id^="sec-"]', doc);

		elements.forEach(function (secnum, stackIndex) {

			var index = secnum.textContent;
			var isAnnex = false;
			if (index.startsWith('Annex')) {
				index = index.replace('Annex', '').trim();
				isAnnex = true;
			}

			var path = index.split('.');
			path = path.reduce(function (path, place) {
				var curr = path[path.length - 1];
				path.push(curr + '.' + place);
				return path;
			}, [path.shift()]);

			var id = secnum.firstChild.getAttribute('href').replace('#', '');

			var title = secnum.parentNode.textContent;

			if (isAnnex) {
				title = title.replace('Annex ' + index, '').trim();
			} else {
				title = title.replace(index, '').trim();
			}

			var children = [];
			var def = { index: index, id: id, title: title, children: children, path: path, stackIndex: stackIndex };
			Data.stack.push(def);

			Data.indexToId[index] = id;
			Data.idToIndex[id] = index;
			Data.indexToFrameIndex[index] = stackIndex;

			var parent = path[path.length - 2];
			if (parent) {
				Data.stack[Data.indexToFrameIndex[parent]].children.push(index);
			}
		});

		return doc;
	}

	function processStack(doc) {
		console.log('starting stack processing of %s frames', Data.stack.length);
		return _Promise.all(Data.stack.map( // we have to defer this because if #8.5 refers to #9.5, the index will not be found
		function (frame) {
			return Store.setItem(frame.index, extractMaterial(frame.id, doc));
		})).then(function (_) {
			return Store.setItem('appdata', Data);
		});
	}

	// *internal* conditionally assigns data-index attribute to element and returns modified element
	function assignIndex(el) {
		var id = el.getAttribute('href');
		if (!id || !id.startsWith('#')) return el;
		var index = Data.idToIndex[id.replace('#', '')];
		if (!index) return el;
		el.setAttribute('href', '#' + index);
		el.dataset.index = index;
		el.classList.add('link-newtab');
		return el;
	}

	function extractMaterial(hash, content) {
		var c = $.id(hash.replace('#', ''), content);
		var f = $.cl('front', c);
		var container = f || c;
		var clone = container.cloneNode(true);
		$$.attr('id', undefined, clone).forEach(function (el) {
			el.removeAttribute('id');
		});
		$$.attr('href^=', '#', clone).forEach(assignIndex);
		return clone.innerHTML;
	}

	function update() {
		console.log('update started');
		domconsole.log('fetching latest version of spec and caching locally. this might take a while.');
		return fetchSpec().then(parseIndex).then(processStack).then(function (_) {
			return window.localStorage.setItem('lastIndexed', Date.now());
		}).then(function (_) {
			console.log('stack processed and saved in indexeddb. marked lastindex in localstorage');
			domconsole.log('caching and parsing completed! you can search for stuff and browse the spec now! :) (double click here to hide me)');
			$.id('console').addEventListener('dblclick', function removeMe() {
				this.classList.add('hidden');
				this.removeEventListener('dblclick', removeMe);
			}, false);
		});
	}

	function initialize() {
		console.log('initializing especser. we have ignition!');
		if (window.localStorage.getItem('lastIndexed')) {
			return Store.getItem('appdata').then(function (val) {
				_export('Data', Data = val);
				console.log('retrieved appdata from indexeddb from %s', localStorage.getItem('lastIndexed'));
			});
		}
		console.log('this session is brand new. starting update threads!');
		return update();
	}

	function clear() {
		console.log('I have got orders from high command to evacuate all data from the ship.');
		domconsole.log('clearing store. this might take some time.');
		Store.clear().then(function (_) {
			return localStorage.removeItem('lastIndexed');
		}).then(function (_) {
			return domconsole.log('store was emptied. click update to cache spec again.');
		});
	}

	// *internal* query to be found in name
	function fuzzySearch(name, query) {
		var max = arguments[2] === undefined ? MAX_RESULTS : arguments[2];

		var pos = -1;
		for (var i = 0, len = query.length; i < len; i++) {
			var char = query[i];
			if (!char.trim()) continue; // removing whitespace
			pos = name.indexOf(char, pos + 1);
			if (pos === -1) return false;
		}
		return true;
	}

	// *internal* searches stack to get queried results
	function executeSearch(stack, query) {
		var max = arguments[2] === undefined ? MAX_RESULTS : arguments[2];

		if (!query) return [];
		query = query.trim().toLowerCase();
		var results = [],
		    directMatches = 0,
		    fuzzyMatches = 0,
		    totalMatches = 0;
		for (var i = 0, len = stack.length; i < len && totalMatches <= max; i++) {
			var title = stack[i].title.toLowerCase();
			if (title.indexOf(query) >= 0) {
				results.unshift(stack[i]);
				directMatches++;
				totalMatches++;
			} else if (fuzzySearch(title, query)) {
				results.push(stack[i]);
				fuzzyMatches++;
				totalMatches++;
			}
		}
		return results;
	}

	function search(query) {
		return executeSearch(Data.stack, query);
	}

	return {
		setters: [function (_npmBabelRuntime558CoreJsPromise) {
			_Promise = _npmBabelRuntime558CoreJsPromise['default'];
		}, function (_srcModUtils) {
			Utils = _srcModUtils;
		}, function (_srcModDomconsole) {
			domconsole = _srcModDomconsole.domconsole;
		}],
		execute: function () {
			'use strict';

			_export('indexToPath', indexToPath);

			_export('indexToFrame', indexToFrame);

			_export('update', update);

			_export('initialize', initialize);

			_export('clear', clear);

			_export('search', search);

			//=================================================================================================
			// storage stuff

			Store = localforage.createInstance({
				name: 'especser',
				storeName: 'sec'
			});

			_export('Store', Store);

			Data = {
				indexToId: {}, // 4.6.5: #sec-foo
				idToIndex: {}, // #sec-foo: 4.6.5...
				// indexToHTML: {}, // index maps to _processed_ html, only in indexedDB
				indexToFrameIndex: {}, // eg: 2.1.3 maps to 17 where 17 is the index of the corresponding frame inside stack
				stack: [] // contains frames containing data
			};

			_export('Data', Data);

			if (window.location.hostname === 'localhost') {
				SPEC_URL = '/spec_cache.html';
				// WE JUST ASSUME SOME STUFF
				// PROBLEM??
			} else {
				SPEC_URL = 'http://crossorigin.me/http://www.ecma-international.org/ecma-262/6.0/index.html';
				// dear speccers, consider allowing cross origin requests
				// yes i called you _speccers_
				// and i wrote i without capitalization (again)
				// come yell at me about it at http://theamountoffucksigive.com
			}

			//=================================================================================================
			// spec usage API to be exposed

			MAX_RESULTS = 8;
			;
		}
	};
});
System.register('src/domhandler', ['npm:babel-runtime@5.5.8/helpers/to-consumable-array', 'src/spec', 'src/mod/shortcuts', 'src/mod/utils'], function (_export) {
	var _toConsumableArray, Spec, Shortcuts, Utils, results, inputBox, active, tabs, descriptorList, openTabDescriptors, suspendedTabs, content, previewBox;

	/**
  * helpers for handlers
  */

	function emphasizeSearch(search, text) {
		return text.replace(RegExp(Utils.re.escape(search), 'gi'), '<b>$&</b>');
	}

	function input$onInput() {
		var val = this.value.trim();
		var results = Spec.search(val);
		active = inputBox;

		var resultsBox = $.id('search-results');

		var resultsDomTree = results.map(function (res) {
			return $.make('li', {
				childNodes: [$.make('a', {
					classList: ['result', 'link-previewer', 'link-newtab'],
					href: '#' + encodeURIComponent(res.index),
					dataset: {
						index: res.index
					},
					childNodes: [$.make('h4', {
						classList: ['result-heading'],
						innerHTML: emphasizeSearch(val, res.title)
					}), $.make('span', {
						classList: ['result-index'],
						textContent: res.index
					}), $.make('span', {
						classList: ['result-path'],
						textContent: Spec.indexToPath(res.index)
					})]
				})]
			});
		});

		$$.tag('li', resultsBox).forEach($.remove);

		resultsDomTree.forEach(function (el) {
			return $.append(el, resultsBox);
		});
	}

	function form$onKeyDown(ev) {
		var DOWN_ARROW = 40;
		var UP_ARROW = 38;
		var ENTER_KEY = 13;
		var ESC_KEY = 27;

		switch (ev.keyCode || ev.which) {
			case DOWN_ARROW:
				ev.preventDefault();
				form$onDownArrow.call(this);
				break;
			case UP_ARROW:
				ev.preventDefault();
				form$onUpArrow.call(this);
				break;
			case ENTER_KEY:
				ev.preventDefault();
				ev.stopImmediatePropagation();
				form$onEnter.call(this, ev);
				break;
			case ESC_KEY:
				ev.preventDefault();
				ev.stopImmediatePropagation();
				form$onEscape.call(this);
				break;
		}
	}

	function form$onDownArrow() {
		if (active === inputBox) {
			return simulateFocus(results[0]);
		}
		if (active.classList.contains('result')) {
			try {
				return simulateFocus(active.parentNode.nextElementSibling.firstChild);
			} catch (er) {}
		}
	}

	function form$onUpArrow() {
		if (active === inputBox) {
			var lastResult = results[results.length - 1];
			if (lastResult) {
				return simulateFocus(lastResult);
			} else return;
		}
		if (active.classList.contains('result')) {
			if (active === results[0]) {
				return;
			}
			try {
				return simulateFocus(active.parentNode.previousElementSibling.firstChild);
			} catch (err) {}
		}
	}

	function form$onEnter(ev) {
		var target = ev.target || ev.srcElement;
		if (target !== inputBox) return;

		if (!active.classList.contains('result')) return;
		target = active;
		clearPreview();
		newTab(Spec.indexToFrame(target.dataset.index));
		form$onEscape.call(this);
	}

	function form$onEscape() {
		clearPreview();
		this.parentNode.classList.add('hidden');
	}

	function simulateFocus(el) {
		active.classList.remove('active');
		el.classList.add('active');
		active = el;
		result$onFocus({ target: el });
	}

	function result$onFocus(ev) {
		var target = ev.target || ev.srcElement;
		previewContent(Spec.indexToFrame(target.dataset.index));
	}

	function anchor$shouldPreventDefault(target) {
		if (target.nodeName === 'A' && target.dataset.index) {
			return target;
		} else if (target.nodeName === 'SPAN') {
			if (target.parentNode.nodeName === 'A' && target.parentNode.dataset.index) return target.parentNode;
		}
		return false;
	}

	function anchor$onClick(ev) {
		return true;
		var target = anchor$shouldPreventDefault(ev.target || ev.srcElement);
		if (!target) return;

		ev.preventDefault();
		if (target.classList.contains('link-newtab')) {
			return newTab(Spec.indexToFrame(target.dataset.index));
		}
		if (target.classList.contains('link-tab-activate')) {}
	}

	function app$navigated(ev) {
		var newIndex = window.location.hash.replace('#', '').trim();
		var frame = Spec.indexToFrame(newIndex);
		if (frame) return newTab(frame);
	}

	function newTab(res) {
		if (tabs.activeTabIndex === res.index) return;
		suspendAnyActiveTab();
		var indexIfOpen = tabs.openIndexes.indexOf(res.index);
		if (indexIfOpen > -1) return activateSuspendedTab(indexIfOpen, res.index);
		var tabDescriptor = $.make('li', {
			childNodes: [$.make('div', {
				classList: ['tab-descriptor', 'link-tab-descriptor', 'active'],
				childNodes: [$.make('a', {
					textContent: res.title,
					href: '#' + res.index,
					dataset: {
						index: res.index
					},
					classList: ['link-tab-activate']
				}), $.make('span', {
					classList: ['tab-close'],
					on: { click: function click(_) {
							return closeTab(res);
						} }
				})]
			})]
		});
		descriptorList.appendChild(tabDescriptor);
		var tabContent = generateView(res);
		tabContent.then(function (tc) {
			$.apply(tc, {
				classList: ['active'],
				dataset: { secIndex: res.index }
			});
			content.appendChild(tc);
			tabs.openIndexes.push(res.index);
			tabs.activeTabIndex = res.index; // and also see if this updates
		});
	}

	function closeTab(res) {
		var tabIndex = tabs.openIndexes.indexOf(res.index);
		tabs.openIndexes.splice(tabIndex, 1);
		$.remove(openTabDescriptors.item(tabIndex));
		if (tabs.tabIndexToRestore === res.index) tabs.tabIndexToRestore = null;
		if (tabs.activeTabIndex === res.index) {
			$.remove($.cl('tab-content active', content));
			tabs.activeTabIndex = null;
			window.history.replaceState({}, '', '#');
			if (tabs.tabIndexToRestore) {
				activateSuspendedTab(tabs.openIndexes.indexOf(tabs.tabIndexToRestore), tabs.tabIndexToRestore);
			} else if (tabs.openIndexes.length) {
				var restorableTabIndex = tabs.openIndexes.length - 1;
				activateSuspendedTab(restorableTabIndex, tabs.openIndexes[restorableTabIndex]);
			}
			return;
		} else {
			$.remove($.data('sec-index=', res.index, suspendedTabs));
			return;
		}
	}

	function suspendAnyActiveTab() {
		var activeTab = $.cl('tab-content active', content);
		if (!activeTab) return;
		activeTab.classList.remove('active');
		$.cl('link-tab-descriptor active').classList.remove('active');
		suspendedTabs.appendChild(activeTab);
		tabs.tabIndexToRestore = tabs.activeTabIndex;
		tabs.activeTabIndex = null;
		window.history.replaceState({}, '', '#');
	}

	function activateSuspendedTab(descriptorIndex, contentIndex) {
		suspendAnyActiveTab();
		openTabDescriptors.item(descriptorIndex).firstChild.classList.add('active');
		var tabContent = $.data('sec-index=', contentIndex, suspendedTabs);
		tabContent.classList.add('active');
		content.appendChild(tabContent);
		tabs.activeTabIndex = contentIndex;
		window.history.replaceState({}, '', '#' + contentIndex);
	}

	function previewContent(res) {
		tabs.tabIndexToRestore = tabs.activeTabIndex;
		suspendAnyActiveTab();
		tabs.state = 'previewing';
		Spec.Store.getItem(res.index).then(function (html) {
			previewBox.innerHTML = html;
			previewBox.classList.remove('hidden');
		});
	}

	function clearPreview() {
		previewBox.classList.add('hidden');
		if (tabs.tabIndexToRestore) {
			activateSuspendedTab(tabs.openIndexes.indexOf(tabs.tabIndexToRestore), tabs.tabIndexToRestore);
		}
	}

	function generateView(res) {
		var path = Spec.indexToPath(res.index);
		var info = $.make('div', {
			classList: ['__info'],
			childNodes: [$.make('span', { classList: ['__info-label'], textContent: 'Path till here' }), $.make('h4', {
				classList: ['__info-path'],
				childNodes: [].concat(_toConsumableArray(res.path.map(function (place) {
					return $.make('a', {
						href: '#' + place,
						textContent: Spec.indexToFrame(place).title
					});
				})))
			})]
		});
		var children = $.make('div', {
			classList: ['__info'],
			childNodes: [$.make('span', { classList: ['__info-label'], textContent: 'Topics inside' }), $.make('h4', {
				classList: ['__info-children'],
				childNodes: res.children.length ? [].concat(_toConsumableArray(res.children.map(function (child) {
					return $.make('div', {
						childNodes: [$.make('span', {
							classList: ['__info-children-index'],
							textContent: child
						}), $.make('a', {
							classList: ['__info-children-anchor'],
							href: '#' + child,
							textContent: Spec.indexToFrame(child).title
						})]
					});
				}))) : [$.make('span', { textContent: 'none' })]
			})]
		});
		var content = $.make('div', {
			classList: ['tab-content'],
			childNodes: [info]
		});
		return Spec.Store.getItem(res.index).then(function (html) {
			content.insertAdjacentHTML('beforeend', html);
			content.appendChild(children);
			return content;
		});
	}
	return {
		setters: [function (_npmBabelRuntime558HelpersToConsumableArray) {
			_toConsumableArray = _npmBabelRuntime558HelpersToConsumableArray['default'];
		}, function (_srcSpec) {
			Spec = _srcSpec;
		}, function (_srcModShortcuts) {
			Shortcuts = _srcModShortcuts;
		}, function (_srcModUtils) {
			Utils = _srcModUtils;
		}],
		execute: function () {
			'use strict';

			/**
    * event handlers
    */

			// a live nodelist increases performance in the following event handlers
			results = document.getElementById('search-results').getElementsByClassName('result');
			inputBox = $.nam('search');
			active = inputBox;
			/**
    * attach the above awesomeness to dom!
    */

			inputBox.addEventListener('input', Utils.throttle(input$onInput, 200, inputBox, 'discard-repeats'), true);
			$.id('search-form').addEventListener('keydown', form$onKeyDown, false);
			$.id('btn-update').addEventListener('click', Spec.initialize, false);
			$.id('btn-clear').addEventListener('click', Spec.clear, false);
			window.addEventListener('hashchange', app$navigated, false);

			/**
    * tab creation, previewing, and handling
    */

			tabs = {
				openIndexes: [],
				activeTabIndex: null,
				tabIndexToRestore: null,
				state: null
			};
			descriptorList = $.id('open-tab-descriptors');
			openTabDescriptors = descriptorList.childNodes;
			suspendedTabs = $.id('suspended-tabs');
			content = $.id('content');
			previewBox = $.id('preview');
		}
	};
});

// return
System.register('src/index', ['github:aaike/jspm-less-plugin@0.0.5', 'src/mod/shortcuts', 'src/mod/sdm', 'src/domhandler', 'src/spec', 'src/mod/domconsole'], function (_export) {
	'use strict';

	var Shortcuts, Spec, domconsole, topbar, search;

	function window$loaded() {
		if (window.localStorage.getItem('lastIndexed')) {
			Spec.initialize();
			// domconsole.log('hi! enter something in the search bar to search the spec. if you don\'t find stuff, trying clicking clear db and try again.');
		} else {
			domconsole.log('hi! especser is an app to search the ECMAScript specification ed6.0. please click update to cache spec for the first time.');
		}
	}

	return {
		setters: [function (_githubAaikeJspmLessPlugin005) {}, function (_srcModShortcuts) {
			Shortcuts = _srcModShortcuts;
		}, function (_srcModSdm) {}, function (_srcDomhandler) {}, function (_srcSpec) {
			Spec = _srcSpec;
		}, function (_srcModDomconsole) {
			domconsole = _srcModDomconsole.domconsole;
		}],
		execute: function () {
			topbar = $.id('top-bar');
			search = $.nam('search');

			Shortcuts.register({ modifier: 'Ctrl', key: 'P' }, function (e) {
				e.preventDefault();
				topbar.classList.toggle('hidden');
				if (topbar.classList.contains('hidden')) return;
				search.focus();
			});

			Shortcuts.register({ key: 'Esc' }, function (e) {
				e.preventDefault();
				topbar.classList.add('hidden');
			});window.addEventListener('load', window$loaded);
		}
	};
});
(function() {
  var loader = System;
  if (typeof indexOf == 'undefined')
    indexOf = Array.prototype.indexOf;

  function readGlobalProperty(p, value) {
    var pParts = p.split('.');
    while (pParts.length)
      value = value[pParts.shift()];
    return value;
  }

  var ignoredGlobalProps = ['sessionStorage', 'localStorage', 'clipboardData', 'frames', 'external'];

  var hasOwnProperty = loader.global.hasOwnProperty;

  function iterateGlobals(callback) {
    if (Object.keys)
      Object.keys(loader.global).forEach(callback);
    else
      for (var g in loader.global) {
        if (!hasOwnProperty.call(loader.global, g))
          continue;
        callback(g);
      }
  }

  function forEachGlobal(callback) {
    iterateGlobals(function(globalName) {
      if (indexOf.call(ignoredGlobalProps, globalName) != -1)
        return;
      try {
        var value = loader.global[globalName];
      }
      catch(e) {
        ignoredGlobalProps.push(globalName);
      }
      callback(globalName, value);
    });
  }

  var moduleGlobals = {};

  var globalSnapshot;

  loader.set('@@global-helpers', loader.newModule({
    prepareGlobal: function(moduleName, deps) {
      // first, we add all the dependency modules to the global
      for (var i = 0; i < deps.length; i++) {
        var moduleGlobal = moduleGlobals[deps[i]];
        if (moduleGlobal)
          for (var m in moduleGlobal)
            loader.global[m] = moduleGlobal[m];
      }

      // now store a complete copy of the global object
      // in order to detect changes
      globalSnapshot = {};
      
      forEachGlobal(function(name, value) {
        globalSnapshot[name] = value;
      });
    },
    retrieveGlobal: function(moduleName, exportName, init) {
      var singleGlobal;
      var multipleExports;
      var exports = {};

      // run init
      if (init)
        singleGlobal = init.call(loader.global);

      // check for global changes, creating the globalObject for the module
      // if many globals, then a module object for those is created
      // if one global, then that is the module directly
      else if (exportName) {
        var firstPart = exportName.split('.')[0];
        singleGlobal = readGlobalProperty(exportName, loader.global);
        exports[firstPart] = loader.global[firstPart];
      }

      else {
        forEachGlobal(function(name, value) {
          if (globalSnapshot[name] === value)
            return;
          if (typeof value === 'undefined')
            return;
          exports[name] = value;
          if (typeof singleGlobal !== 'undefined') {
            if (!multipleExports && singleGlobal !== value)
              multipleExports = true;
          }
          else {
            singleGlobal = value;
          }
        });
      }

      moduleGlobals[moduleName] = exports;

      return multipleExports ? exports : singleGlobal;
    }
  }));
})();
});
//# sourceMappingURL=index.js.map