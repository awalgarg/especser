import * as Spec from './spec';
import * as Shortcuts from './mod/shortcuts';
import * as Utils from './mod/utils';
import {domconsole} from './mod/domconsole';

/**
 * helpers for handlers
 */

function emphasizeSearch (search, text) {
	return text.replace(RegExp(Utils.re.escape(search), 'gi'), '<b>$&</b>');
}

/**
 * event handlers
 */

// a live nodelist increases performance in the following event handlers
let results = document.getElementById('search-results').getElementsByClassName('result');
let inputBox = $.nam('search');
let active = inputBox;
let resultsGenerator;
let resultsBox = $.id('search-results');

function createResultList (results, val) {
	return results.map(res => $.make('li', {
			childNodes: [$.make('a', {
				classList: ['result', 'link-newtab'],
				href: `#${encodeURIComponent(res.index)}`,
				dataset: {
					index: res.index
				},
				on: {
					click: function (e) {
						e.preventDefault();
						active.classList.remove('active');
						this.classList.add('active');
						active = this;
						form$onEnter.call($.id('search-form'), {target: inputBox});
					}
				},
				childNodes: [
					$.make('h4', {
						classList: ['result-heading'],
						innerHTML: emphasizeSearch(val, res.title)
					}),
					$.make('span', {
						classList: ['result-index'],
						textContent: res.index
					}),
					$.make('span', {
						classList: ['result-path'],
						textContent: Spec.indexToPath(res.index)
					})
				]
			})]
		}));
}

function input$onInput () {
	let val = this.value.trim();
	resultsGenerator = Spec.search(val);
	active = inputBox;

	let resultList = createResultList(resultsGenerator.next().value, val);

	$$.tag('li', resultsBox).forEach($.remove);

	resultList.forEach(el => $.append(el, resultsBox));
}

function form$onKeyDown (ev) {
	const DOWN_ARROW = 40;
	const UP_ARROW = 38;
	const ENTER_KEY = 13;
	const ESC_KEY = 27;

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

function form$onDownArrow () {
	if (active === inputBox) {
		return results[0] && simulateFocus(results[0]);
	}
	if (active.classList.contains('result')) {
		if (active === resultsBox.lastElementChild.firstElementChild) {
			let moreResults = resultsGenerator.next();
			if (moreResults.done) return;
			if (moreResults.value.length) {
				let resultList = createResultList(moreResults.value, inputBox.value.trim());
				resultList.forEach(el => $.append(el, resultsBox));
				simulateFocus(resultList[0].firstChild);
				return;
			}
			return;
		}
		try {
			return simulateFocus(active.parentNode.nextElementSibling.firstChild);
		} catch (er) {}
	}
}

function form$onUpArrow () {
	if (active === inputBox) {
		let lastResult = results[results.length - 1];
		if (lastResult) {
			return simulateFocus(lastResult);
		}
		else return;
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

function form$onEnter (ev) {
	let target = ev.target || ev.srcElement;
	if (target !== inputBox) return;

	if (!active.classList.contains('result')) return;
	target = active;
	openTab(target.dataset.index);
	form$onEscape.call(this);
}

function form$onEscape () {
	this.parentNode.classList.add('hidden');
}

function simulateFocus (el) {
	active.classList.remove('active');
	el.classList.add('active');
	active = el;
	el.scrollIntoView();
}

function window$loaded (ev) {
	if (window.localStorage.getItem('lastIndexed')) {
		Spec.initialize().then(_ => app$navigated.call(this, ev));
	}
	else {
		domconsole.log('hi! especser is an app to search the ECMAScript specification ed6.0. please click update to cache spec for the first time.');
	}
}

function app$navigated (ev) {
	let newIndex = window.location.hash.replace('#', '').trim();
	let frame = Spec.indexToFrame(newIndex);
	if (frame) {
		Promise.resolve(openTab(newIndex)).then(_ => $.id('top-bar').classList.add('hidden'));
	}
}

/**
 * attach the above awesomeness to dom!
 */

inputBox.addEventListener('input', Utils.throttle(input$onInput, 200, inputBox, 'discard-repeats'), true);
$.id('search-form').addEventListener('keydown', form$onKeyDown, false);
$.id('btn-update').addEventListener('click', Spec.initialize, false);
$.id('btn-clear').addEventListener('click', Spec.clear, false);
window.addEventListener('hashchange', app$navigated, false);
window.addEventListener('load', window$loaded);

/**
 * tab creation, previewing, and handling
 */

import {TabGroup, Tab} from './mod/tabbing';

let group = new TabGroup();

let content = $.id('content');
let suspendedTabs = $.id('suspended-tabs');
let descriptorList = $.id('open-tab-descriptors');

let state = {
	open: Object.create(null),
	tokenToIndexMap: Object.create(null),
	get activeTabIndex () {
		let el = $.cl('tab-content', content);
		if (!el) return;
		return el.dataset.secIndex;
	}
};

function openTab (index) {
	if (index in state.open) {
		return group.open(state.open[index]);
	}

	let tabData = Spec.indexToFrame(index);

	let descriptor = createDescriptor(tabData);
	descriptorList.appendChild(descriptor);
	descriptor.scrollIntoView();

	let tab = new Tab(tabData.title, tabData.path, index);
	let tabToken = group.attach(tab);

	state.open[index] = tabToken;
	state.tokenToIndexMap[tabToken] = index;
}

function createDescriptor (res) {
	return $.make('li', {
		childNodes: [
			$.make('div', {
				classList: ['tab-descriptor', 'link-tab-descriptor', 'active'],
				childNodes: [
					$.make('a', {
						textContent: res.title,
						href: `#${res.index}`,
						dataset: {
							index: res.index
						},
						classList: ['link-tab-activate']
					}),
					$.make('span', {
						classList: ['tab-close'],
						on: {
							click: function () {
								group.detach(state.open[res.index]);
								$.remove(this.parentNode.parentNode);
							}
						}
					})
				]
			})
		]
	});
}

function closeTab (index) {
	if (!(index in state.open)) {
		return;
	}
	group.detach(state.open[index]);
	delete state.tokenToIndexMap[token];
	delete state.open[index];
}

function storeAsSuspended (index, data) {
	if (!data) return;
	$.remove(data);
	$.apply(data, {
		classList: ['tab-content'],
		dataset: {
			secIndex: index
		}
	});
	suspendedTabs.appendChild(data);
}

function getDescriptor (index) {
	return $.data('index=', index, descriptorList).parentNode.parentNode;
}

function suspendActiveTab () {
	let index = state.activeTabIndex;
	if (!index) return;
	let data = $.data('sec-index=', index, content);
	storeAsSuspended(index, data);
}

function getFromSuspended (index) {
	return $.data('sec-index=', index, suspendedTabs);
}

function onAttach ({id: token}) {
	let index = group.tabs[token].meta;

	let el = generateView(Spec.indexToFrame(index));
	el.then(data => storeAsSuspended(index, data)).then(_ => group.open(token));
}

function onOpen ({id: token}) {
	let index = group.tabs[token].meta;
	suspendActiveTab();
	content.appendChild(getFromSuspended(index));
	$.cl('tab-descriptor', getDescriptor(index)).classList.add('active');
}

function onClose ({id: token}) {
	suspendActiveTab();
	$.cl('active', descriptorList).classList.remove('active');
}

function onDetach ({id: token}) {
	$.remove(getFromSuspended(state.tokenToIndexMap[token]));
	group.restoreLast();
}

group.events.on('open', onOpen);
group.events.on('close', onClose);
group.events.on('attach', onAttach);
group.events.on('detach', onDetach);

function generateView (res) {
	let path = Spec.indexToPath(res.index);
	let info = $.make('div', {
		classList: ['__info'],
		childNodes: [
			$.make('span', {classList: ['__info-label'], textContent: 'Path till here'}),
			$.make('h4', {
				classList: ['__info-path'],
				childNodes: [...res.path.map(place => $.make('a', {
					href: `#${place}`,
					textContent: Spec.indexToFrame(place).title
				}))]
			})
		]
	});
	let children = $.make('div', {
		classList: ['__info'],
		childNodes: [
			$.make('span', {classList: ['__info-label'], textContent: 'Topics inside'}),
			$.make('h4', {
				classList: ['__info-children'],
				childNodes: res.children.length ? [...res.children.map(child => $.make('div', {
					childNodes: [
						$.make('span', {
							classList: ['__info-children-index'],
							textContent: child
						}),
						$.make('a', {
							classList: ['__info-children-anchor'],
							href: `#${child}`,
							textContent: Spec.indexToFrame(child).title
						})
					]
				}))] : [$.make('span', {textContent: 'none'})]
			})
		]
	});
	let content = $.make('div', {
		classList: ['tab-content'],
		childNodes: [info]
	});
	return Spec.Store.getItem(res.index).then(
		html => {
			content.insertAdjacentHTML('beforeend', html);
			content.appendChild(children);
			return content;
		}
	);
}
