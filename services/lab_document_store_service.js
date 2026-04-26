'use strict';

const panelsByUser = new Map();

function getLatestPanelForUser(userId) {
  if (!userId) return null;
  const panels = panelsByUser.get(userId) || [];
  return panels[panels.length - 1] || null;
}

function savePanelForUser(userId, panel) {
  if (!userId || !panel) return null;
  const panels = panelsByUser.get(userId) || [];
  panels.push(panel);
  panelsByUser.set(userId, panels.slice(-10));
  return panel;
}

module.exports = {
  getLatestPanelForUser,
  savePanelForUser
};
