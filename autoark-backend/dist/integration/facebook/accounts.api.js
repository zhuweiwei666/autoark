"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUserAdAccounts = void 0;
const facebookClient_1 = require("./facebookClient");
const fetchUserAdAccounts = async (token) => {
    const params = {
        fields: 'id,account_status,name,currency,balance,spend_cap,amount_spent,disable_reason',
        limit: 500,
    };
    if (token) {
        params.access_token = token;
    }
    const res = await facebookClient_1.facebookClient.get('/me/adaccounts', params);
    return res.data || [];
};
exports.fetchUserAdAccounts = fetchUserAdAccounts;
