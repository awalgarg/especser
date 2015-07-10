;(function (window, document) {
    
    /**
     * simple dom module (sdm)
     * Copyright (c) Awal Garg aka Rash <https://github.com/awalGarg>
     * License WTFPL
     */
    
    "use strict";
    
    function slice (stuff) {
        return stuff && Array.prototype.slice.call(stuff);
    }
    
    function type (stuff) {
        return ({}).toString.call(stuff).replace('[object ', '').replace(']', '').toLowerCase();
    }

    var $ = window.$ = function (sel, parent) {
        return (parent||document).querySelector(sel);
    };
    var $$ = window.$$ = function (sel, parent) {
        return slice((parent||document).querySelectorAll(sel));
    };
    function wrapQuotes (val) {
        if (val) return '"' + val + '"';
        return val;
    }
    $.id = function (id, parent) {
        return (parent || document).getElementById(id);
    };
    $.cl = function (cl, parent) {
        return $$.cl(cl, parent)[0];
    };
    $.nam = function (nam, parent) {
        return $$.nam(nam, parent)[0];
    };
    $.tag = function (tag, parent) {
        return $$.tag(tag, parent)[0];
    };
    $.attr = function (attr, val, parent) {
        if (typeof val === 'undefined') val = '';
        return (parent||document).querySelector('[' + attr + wrapQuotes(val) + ']');
    };
    $.data = function (set, val, parent) {
        return $.attr('data-' + set, val, parent);
    };
    
    $$.cl = function (cl, parent) {
        return slice((parent||document).getElementsByClassName(cl));
    };
    $$.nam = function (nam, parent) {
        return slice((parent||document).getElementsByName(nam));
    };
    $$.tag = function (tag, parent) {
        return slice((parent||document).getElementsByTagName(tag));
    };
    $$.attr = function (attr, val, parent) {
        if (typeof val === 'undefined') val = '';
        return slice((parent||document).querySelectorAll('[' + attr + wrapQuotes(val) + ']'));
    };
    $$.data = function (set, val, parent) {
        return $$.attr('data-' + set, val, parent);
    };
    
    function assignProps (obj, stuff) {
        if (obj && stuff) Object.keys(stuff).forEach(function (key) {
            obj[key] = stuff[key];
        });
    }
    
    $.apply = function (el, opts) {

        if (!opts) return el;

        assignProps(el.style, opts.style);
        delete opts.style;
        assignProps(el.dataset, opts.dataset);
        delete opts.dataset;
        if (opts.classList) opts.classList.forEach(function (cl) {
            el.classList.add(cl);
        });
        delete opts.dataset;
        if (opts.childNodes) opts.childNodes.forEach(function (child) {
            el.appendChild(child);
        });
        delete opts.childNodes;
        var events = opts.on;
        if (events) Object.keys(events).forEach(function (ev) {
            var det = events[ev];
            if (type(det) !== 'array') det = [det];
            det.forEach(function(li) {
                var maybeCapture = type(li) === 'array';
                el.addEventListener(
                    ev,
                    maybeCapture ? li[0] : li,
                    maybeCapture ? li[1] : false
                );
            });
        });
        delete opts.on;
        if (opts.attributes) Object.keys(opts.attributes).forEach(function (attr) {
            el.setAttribute(attr, opts.attributes[attr]);
        });

        
        Object.keys(opts).forEach(function (key) {
            try {
                el[key] = opts[key];
            }
            catch (e) {}
        });
        
        return el;

    };
    
    $.make = function make (sign, opts) {
        
        if (sign === '#text') return document.createTextNode(opts);

        if (sign === '#frag') return $.apply(
            document.createDocumentFragment(),
            {childNodes: opts && opts.childNodes}
        );
        
        var el;
        
        if (typeof sign === 'string') {
            el = document.createElement(sign);
        }
        else {
            el = sign.cloneNode(opts && opts.deep);
        }

        if (!opts) return el;

        delete opts.deep;
        
        return $.apply(el, opts);
    };

    $.append = function (elem, refElem, position) {
        position = (position || "bottom").toLowerCase();

        if (position === "top") {
            if (!refElem.childNodes.length) return refElem.appendChild(elem);
            return refElem.insertBefore(elem, refElem.firstChild);
        }
        else if (position === "bottom") {
            return refElem.appendChild(elem);
        }
        else if (position === "before") {
            return refElem.parentNode.insertBefore(elem, refElem);
        }
        else if (position === "after") {
            if (!refElem.nextElementSibling) return refElem.parentNode.appendChild(elem);
            return refElem.parentNode.insertBefore(elem, refElem.nextElementSibling);
        }
        else if (position === "replace") {
            return refElem.parentNode.replaceChild(elem, refElem);
        }
        else {
            throw new Error('Unknown position specified. Expected "top", "bottom", "before", "after" or "replace".');
        }

    };

    $.remove = function (node) {
        if (typeof node === 'string') node = $(node);
        if (node && node.parentNode) node.parentNode.removeChild(node);
    };

})(window, document);