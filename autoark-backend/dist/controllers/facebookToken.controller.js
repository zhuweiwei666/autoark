"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveFacebookToken = void 0;
const FbToken_1 = __importDefault(require("../models/FbToken"));
const axios_1 = __importDefault(require("axios"));
const saveFacebookToken = async (req, res) => {
    try {
        const { token } = req.body;
        const userId = 'default-user'; // no login now
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }
        // Validate token via FB API
        try {
            const check = await axios_1.default.get(`https://graph.facebook.com/me?access_token=${token}`);
            if (!check.data || !check.data.id) {
                return res.status(400).json({ error: 'Invalid FB token' });
            }
            await FbToken_1.default.findOneAndUpdate({ userId }, { token, updatedAt: new Date() }, { new: true, upsert: true });
            return res.json({
                message: 'Facebook token saved successfully',
                fbUser: check.data,
            });
        }
        catch (apiErr) {
            return res
                .status(400)
                .json({ error: 'Invalid Facebook Token (API verification failed)' });
        }
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
exports.saveFacebookToken = saveFacebookToken;
