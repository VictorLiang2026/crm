import { t } from './console/i18n.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function link(label, href, className = 'btn btn-primary') {
  const element = node('a', className, label);
  element.href = href;
  return element;
}

export function renderLegacyCustomerRoute({ root }) {
  const page = node('section', 'phase14-page legacy-customer-route');
  page.append(node('p', 'phase14-kicker', t('legacy_customer_route_kicker')),
    node('h2', '', t('legacy_customer_route_title')),
    node('p', 'phase14-intro', t('legacy_customer_route_intro')));
  const actions = node('div', 'phase14-route-actions');
  root.replaceChildren(page);
  page.append(actions);
  actions.append(link(t('legacy_customer_route_people_link'), '#/people'));
}
