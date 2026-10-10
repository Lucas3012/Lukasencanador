const mongoose = require('mongoose');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

const AuthSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    value: { type: String, required: true }
}, { collection: 'sessions' });

const AuthModel = mongoose.models.Session || mongoose.model('Session', AuthSchema);

module.exports = async function useMongoDBAuthState() {
    const writeData = async (data, id) => {
        try {
            const value = JSON.stringify(data, BufferJSON.replacer);
            await AuthModel.updateOne({ _id: id }, { value }, { upsert: true });
        } catch (err) {
            console.error(`Erro ao salvar session (${id}):`, err.message);
        }
    };

    const readData = async (id) => {
        try {
            const doc = await AuthModel.findById(id).lean();
            if (doc && doc.value) {
                return JSON.parse(doc.value, BufferJSON.reviver);
            }
        } catch (err) {
            console.error(`Erro ao ler session (${id}):`, err.message);
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await AuthModel.deleteOne({ _id: id });
        } catch (err) {
            console.error(`Erro ao remover session (${id}):`, err.message);
        }
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
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
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
