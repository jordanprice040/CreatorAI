'use strict';
const $ = (id) => document.getElementById(id);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLANS = { free: 'Free', pro: 'Pro' };
function show(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}
$('signup').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('name').value.trim();
  const email = $('email').value.trim();
  const errors = {
    'name-error':
      name.length >= 2 && name.length <= 40
        ? ''
        : 'Enter your name (2 to 40 characters)',
    'email-error': EMAIL.test(email) ? '' : 'Enter a valid email address',
    'terms-error': $('terms').checked ? '' : 'Accept the terms to continue',
  };
  for (const [id, text] of Object.entries(errors)) show(id, text);
  const count = Object.values(errors).filter(Boolean).length;
  if (count) {
    show('summary', `Fix ${count} ${count === 1 ? 'problem' : 'problems'}`);
    return;
  }
  show('summary', '');
  $('signup').hidden = true;
  show(
    'done',
    `Welcome, ${name}! You chose the ${PLANS[$('plan').value]} plan.`,
  );
});
