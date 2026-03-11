import axios from "axios";
import http from 'http';
import https from 'https';
import { API_URL_ANFETA } from '../config.js';

export const axiosAnfeta = axios.create({
    baseURL: API_URL_ANFETA,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 30000
});