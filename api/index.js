const { createServer } = require('http');
const { parse } = require('url');
const fetch = require('node-fetch');
require('dotenv').config();

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now) return cachedToken;

  const response = await fetch(`https://id.twitch.tv/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
  });

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

function processCompanies(companies) {
  if (!companies) return { developers: [], publishers: [] };
  
  const developers = companies
    .filter(c => c.developer)
    .map(c => c.company.name);
  
  const publishers = companies
    .filter(c => c.publisher)
    .map(c => c.company.name);
  
  return {
    developers: [...new Set(developers)],
    publishers: [...new Set(publishers)]
  };
}

function getAgeRating(rating) {
  const ratings = {
    1: 'PEGI 3',
    2: 'PEGI 7',
    3: 'PEGI 12',
    4: 'PEGI 16',
    5: 'PEGI 18',
    6: 'RP (Classificação Pendente)',
    7: 'EC (Primeira Infância)',
    8: 'E (Todos)',
    9: 'E10+ (Todos +10)',
    10: 'T (Adolescentes)',
    11: 'M (Maduro 17+)',
    12: 'AO (Apenas Adultos)'
  };
  return ratings[rating] || 'Desconhecido';
}

async function handleGameRequest(req, res) {
  try {
    const { pathname } = parse(req.url, true);
    const gameId = pathname.split('/')[2];
    const token = await getAccessToken();

    const gameResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, summary, first_release_date, category, age_ratings.rating, 
             cover.url, artworks.url, screenshots.url, platforms.name, 
             involved_companies.company.name, involved_companies.developer, 
             involved_companies.publisher; where id = ${gameId};`
    });

    const gameData = await gameResponse.json();

    if (!gameData[0]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: "Game not found" }));
    }

    const game = gameData[0];
    const result = {
      id: game.id,
      name: game.name,
      summary: game.summary,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toLocaleDateString() : 'Desconhecido',
      cover: game.cover ? { url: game.cover.url } : null,
      artworks: game.artworks ? game.artworks.map(art => ({ url: art.url })) : [],
      screenshots: game.screenshots ? game.screenshots.map(ss => ({ url: ss.url })) : [],
      platforms: game.platforms ? game.platforms.map(p => p.name) : [],
      ageRating: game.age_ratings ? getAgeRating(game.age_ratings[0].rating) : 'Desconhecido',
      genres: game.genres || [],
      companies: processCompanies(game.involved_companies)
    };

    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error("Error fetching game data:", error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

async function handlePopularRequest(req, res) {
  try {
    const token = await getAccessToken();
    
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, cover.url, screenshots.url; 
             where total_rating_count > 50 & (cover != null | screenshots != null); 
             sort total_rating_count desc; 
             limit 50;`
    });

    const data = await response.json();
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data.map(game => ({
      id: game.id,
      name: game.name,
      cover: game.cover ? { url: game.cover.url } : null,
      screenshots: game.screenshots ? game.screenshots.map(ss => ({ url: ss.url })) : []
    }))));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

async function handleGenreRequest(req, res) {
  try {
    const { pathname } = parse(req.url, true);
    const genreId = pathname.split('/')[2];
    const token = await getAccessToken();
    
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, cover.url; 
             where genres = (${genreId}) & cover != null; 
             sort total_rating_count desc; 
             limit 50;`
    });

    const data = await response.json();
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data.map(game => ({
      id: game.id,
      name: game.name,
      cover: game.cover ? { url: game.cover.url } : null
    }))));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

function handleRootRequest(req, res) {
  res.writeHead(200, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({
    message: "IGDB API está funcionando!",
    endpoints: {
      game: "/game/:id",
      popular: "/popular",
      genre: "/genre/:id"
    }
  }));
}

module.exports = async (req, res) => {
  const { pathname } = parse(req.url, true);

  switch (pathname) {
    case '/':
      return handleRootRequest(req, res);
    case '/popular':
      return handlePopularRequest(req, res);
    default:
      if (pathname.startsWith('/game/')) {
        return handleGameRequest(req, res);
      } else if (pathname.startsWith('/genre/')) {
        return handleGenreRequest(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Endpoint not found" }));
      }
  }
};