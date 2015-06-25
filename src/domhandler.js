import * as Spec from './spec';
import * as Shortcuts from './mod/shortcuts';
import * as Utils from './mod/utils';

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

function input$onInput () {
	let val = this.value.trim();
	let results = Spec.search(val);
	active = inputBox;

	let resultsBox = $.id('search-results');

	let resultsDomTree = results.map(res => {
		return $.make('li', {
			childNodes: [$.make('a', {
				classList: ['result', 'link-previewer', 'link-newtab'],
				href: `#${encodeURIComponent(res.index)}`,
				dataset: {
					index: res.index
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
		});
	});

	$$.tag('li', resultsBox).forEach($.remove);

	resultsDomTree.forEach(el => $.append(el, resultsBox));
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
		return simulateFocus(results[0]);
	}
	if (active.classList.contains('result')) {
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
	clearPreview();
	newTab(Spec.indexToFrame(target.dataset.index));
	form$onEscape.call(this);
}

function form$onEscape () {
	clearPreview();
	this.parentNode.classList.add('hidden');
}

function simulateFocus (el) {
	active.classList.remove('active');
	el.classList.add('active');
	active = el;
	result$onFocus({target: el});
}

function result$onFocus (ev) {
	let target = ev.target || ev.srcElement;
	previewContent(Spec.indexToFrame(target.dataset.index));
}

function anchor$shouldPreventDefault (target) {
	if (target.nodeName === 'A' && target.dataset.index) {
		return target;
	}
	else if (target.nodeName === 'SPAN') {
		if (target.parentNode.nodeName === 'A' && target.parentNode.dataset.index) return target.parentNode;
	}
	return false;
}

function anchor$onClick (ev) {
	return true;
	let target = anchor$shouldPreventDefault(ev.target || ev.srcElement);
	if (!target) return;

	ev.preventDefault();
	if (target.classList.contains('link-newtab')) {
		return newTab(Spec.indexToFrame(target.dataset.index));
	}
	if (target.classList.contains('link-tab-activate')) {
		// return 
	}
}

function app$navigated (ev) {
	let newIndex = window.location.hash.replace('#', '').trim();
	let frame = Spec.indexToFrame(newIndex);
	if (frame) return newTab(frame);
}

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

let tabs = {
	openIndexes: [],
	activeTabIndex: null,
	tabIndexToRestore: null,
	state: null
};

let descriptorList = $.id('open-tab-descriptors');
let openTabDescriptors = descriptorList.childNodes;
let suspendedTabs = $.id('suspended-tabs');
let content = $.id('content');
let previewBox = $.id('preview');

function newTab (res) {
	if (tabs.activeTabIndex === res.index) return;
	suspendAnyActiveTab();
	let indexIfOpen = tabs.openIndexes.indexOf(res.index);
	if (indexIfOpen > -1) return activateSuspendedTab(indexIfOpen, res.index);
	let tabDescriptor = $.make('li', {
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
						on: { click: _ => closeTab(res) }
					})
				]
			})
		]
	});
	descriptorList.appendChild(tabDescriptor);
	let tabContent = generateView(res);
	tabContent.then(tc => {
		$.apply(tc, {
			classList: ['active'],
			dataset: {secIndex: res.index}
		});
		content.appendChild(tc);
		tabs.openIndexes.push(res.index);
		tabs.activeTabIndex = res.index; // and also see if this updates
	});
}

function closeTab (res) {
	let tabIndex = tabs.openIndexes.indexOf(res.index);
	tabs.openIndexes.splice(tabIndex, 1);
	$.remove(openTabDescriptors.item(tabIndex));
	if (tabs.tabIndexToRestore === res.index) tabs.tabIndexToRestore = null;
	if (tabs.activeTabIndex === res.index) {
		$.remove($.cl('tab-content active', content));
		tabs.activeTabIndex = null;
		window.history.replaceState({}, '', '#');
		if (tabs.tabIndexToRestore) {
			activateSuspendedTab(tabs.openIndexes.indexOf(tabs.tabIndexToRestore), tabs.tabIndexToRestore);
		}
		else if (tabs.openIndexes.length) {
			let restorableTabIndex = tabs.openIndexes.length - 1;
			activateSuspendedTab(restorableTabIndex, tabs.openIndexes[restorableTabIndex]);
		}
		return;
	}
	else {
		$.remove($.data('sec-index=', res.index, suspendedTabs));
		return;
	}
}

function suspendAnyActiveTab () {
	let activeTab = $.cl('tab-content active', content);
	if (!activeTab) return;
	activeTab.classList.remove('active');
	$.cl('link-tab-descriptor active').classList.remove('active');
	suspendedTabs.appendChild(activeTab);
	tabs.tabIndexToRestore = tabs.activeTabIndex;
	tabs.activeTabIndex = null;
	window.history.replaceState({}, '', '#');
}

function activateSuspendedTab (descriptorIndex, contentIndex) {
	suspendAnyActiveTab();
	openTabDescriptors.item(descriptorIndex).firstChild.classList.add('active');
	let tabContent = $.data('sec-index=', contentIndex, suspendedTabs);
	tabContent.classList.add('active');
	content.appendChild(tabContent);
	tabs.activeTabIndex = contentIndex;
	window.history.replaceState({}, '', `#${contentIndex}`);
}

function previewContent (res) {
	tabs.tabIndexToRestore = tabs.activeTabIndex;
	suspendAnyActiveTab();
	tabs.state = 'previewing';
	Spec.Store.getItem(res.index).then(html => {
		previewBox.innerHTML = html;
		previewBox.classList.remove('hidden');
	});
}

function clearPreview () {
	previewBox.classList.add('hidden');
	if (tabs.tabIndexToRestore) {
		activateSuspendedTab(tabs.openIndexes.indexOf(tabs.tabIndexToRestore), tabs.tabIndexToRestore);
	}
}

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
