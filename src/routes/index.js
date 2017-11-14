import express from 'express';
import fetch from 'node-fetch';
import marked from 'marked';
import ensureIsAdmin from '../middlewares/ensure-is-admin';

import App from '../models/app';

const router = express.Router();

import adminRoutes from './admin';
import apiRoutes from './api';
import appRoutes from './apps';
import authRoutes from './auth';
import sitemapRoute from './sitemap';

router.get(['/', '/download', '/downloads'], (req, res) => {
  const ua = req.headers['user-agent'];
  if (/(Intel|PPC) Mac OS X/.test(ua)) {
    res.redirect('/download/mac');
  } else if (/(Linux x86_64|Linux i686)/.test(ua)) {
    res.redirect('/download/linux');
  } else {
    res.redirect('/download/windows');
  }
});

router.get('/downloads/:platform(mac|windows|linux)', (req, res) => {
  const { platform } = req.params;

  res.redirect(`/download/${platform}`);
});

router.get('/download/:platform(mac|windows|linux)', (req, res) => {
  Promise.resolve()
    .then(() => {
      const promises = [];

      let topApps = [];
      let newApps = [];

      const opts = {
        where: { isActive: true },
        offset: 0,
        limit: 12,
      };
      const topAppOpts = Object.assign({}, opts, { order: [['installCount', 'DESC'], ['createdAt', 'DESC']] });
      const newAppOpts = Object.assign({}, opts, { order: [['createdAt', 'DESC']] });

      promises.push(App.findAll(topAppOpts)
        .then((rows) => {
          topApps = rows;
        }));

      promises.push(App.findAll(newAppOpts)
        .then((rows) => {
          newApps = rows;
        }));

      return Promise.all(promises)
        .then(() => ({
          topApps,
          newApps,
        }));
    })
    .then(({ topApps, newApps }) => {
      const { platform } = req.params;
      const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

      let dockName = 'dock';
      if (platform === 'windows') dockName = 'taskbar';
      if (platform === 'linux') dockName = 'launcher';

      res.render('download', {
        version: process.env.VERSION,
        platform,
        dockName,
        title: `Download WebCatalog for ${platformName}`,
        topApps,
        newApps,
      });
    });
});

let cachedContent;
router.get('/release-notes', (req, res, next) => {
  if (cachedContent) {
    return res.render('release-notes', { title: 'Release Notes', releaseNotes: marked(cachedContent) });
  }

  return fetch(`https://raw.githubusercontent.com/webcatalog/webcatalog/v${process.env.VERSION}/RELEASE_NOTES.md`)
    .then(response => response.text())
    .then((mdContent) => {
      cachedContent = mdContent;
      return res.render('release-notes', { title: 'Release Notes', releaseNotes: marked(mdContent) });
    })
    .catch(next);
});

router.get('/support', (req, res) => {
  res.redirect('/contact');
});

router.get('/help', (req, res) => {
  res.redirect('/contact');
});

router.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact' });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy' });
});

router.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms of Service' });
});

router.get('/s3/:name.:ext', (req, res) => {
  res.redirect(`https://cdn.webcatalog.io/${req.params.name}.${req.params.ext}`);
});

router.use('/admin', ensureIsAdmin, adminRoutes);
router.use('/api', apiRoutes);
router.use('/apps', appRoutes);
router.use('/auth', authRoutes);
router.use('/sitemap.xml', sitemapRoute);

export default router;
