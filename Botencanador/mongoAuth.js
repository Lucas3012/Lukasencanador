const mongoose = require('mongoose');
const { BufferJSON, initAuthCreds } = require('@itsliaaa/baileys');

const AuthSchema = new mongoose.Schema({
    _id: String,
    data: String
}, { collection: 'baileys_auth' });

const AuthModel = mongoose.models.BaileysAuth || mongoose.model('BaileysAuth', AuthSchema);

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try {
            const value = JSON.stringify(data, BufferJSON.replacer);
            await AuthModel.findByIdAndUpdate(id, { data: value }, { upsert: true });
        } catch (err) {
            console.error(`Erro ao salvar sessão [${id}]:`, err);
        }
    };

    const readData = async (id) => {
        try {
            const doc = await AuthModel.findById(id);
            if (!doc || !doc.data) return null;
            return JSON.parse(doc.data, BufferJSON.reviver);
        } catch (err) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await AuthModel.findByIdAndDelete(id);
        } catch (err) {}
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = BufferJSON.reviver('', value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

module.exports = useMongoDBAuthState;
