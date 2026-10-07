'use strict';

// Whole-state repository boundary. Keep the key and schema stable for existing users.
const diaryRepository = {
  key: 'bellaDiary.store',

  async load() {
    try {
      const saved = localStorage.getItem(this.key);
      if (saved === null) return null;
      const parsed = JSON.parse(saved);
      if (parsed === null) throw new Error('Saved diary contains null.');
      return parsed;
    } catch (error) {
      throw new Error(`Could not read the saved diary: ${error.message}`);
    }
  },

  async save(store) {
    try {
      localStorage.setItem(this.key, JSON.stringify(store));
    } catch (error) {
      throw new Error(`Could not save the diary: ${error.message}`);
    }
  }
};
