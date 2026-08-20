import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import 'ant-design-vue/dist/reset.css';
import './styles.css';

const routes = [
    { path: '/', component: () => import('@/components/v4/Overview.vue') },
    { path: '/connections', component: () => import('@/components/v4/Connections.vue') },
    { path: '/requests', component: () => import('@/components/v4/Requests.vue') },
    { path: '/browser', component: () => import('@/components/v4/LiveBrowser.vue') },
    { path: '/settings', component: () => import('@/components/v4/Settings.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
];

const router = createRouter({
    history: createWebHistory(),
    routes
})

const pinia = createPinia()
const app = createApp(App);
app.use(pinia)
app.use(router)
app.mount('#app')
