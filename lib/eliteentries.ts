import axios, { AxiosResponse, AxiosError } from 'axios';
import { orderData } from './types';

// Place Trade Functon
export const placeTrade = async (data: orderData) => {
    const funcUrl = "https://placeorder-6ikqnahfla-uc.a.run.app";
    try {
        const resp: AxiosResponse = await axios.post(funcUrl, data);
        return resp.data;
    } catch (e) {
        return (e as AxiosError).response;
    }
}

export default {
    placeTrade,
}