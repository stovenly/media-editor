import '@fontsource-variable/inter';
import './app.css';
import { mount } from 'svelte';
import App from './app/App.svelte';
import { registerServiceWorker } from './sw/register';

registerServiceWorker();

mount(App, { target: document.getElementById('app')! });
