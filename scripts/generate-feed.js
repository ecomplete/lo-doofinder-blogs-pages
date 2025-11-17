const fs = require('fs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Configuration
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g., 'latitudes-online.myshopify.com'
const STOREFRONT_ACCESS_TOKEN = process.env.STOREFRONT_ACCESS_TOKEN;
const SITE_URL = 'https://latitudes.online'; // Your public site URL

// GraphQL query for blog articles
const ARTICLES_QUERY = `
  query GetArticles($cursor: String) {
    articles(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          content
          contentHtml
          excerpt
          publishedAt
          image {
            url
            altText
          }
          blog {
            handle
          }
          author {
            name
          }
          tags
        }
      }
    }
  }
`;

// GraphQL query for pages
const PAGES_QUERY = `
  query GetPages($cursor: String) {
    pages(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          body
          bodySummary
          createdAt
          updatedAt
        }
      }
    }
  }
`;

const METAOBJECT_QUERY = `
  query GetMetaobjects($type: String!, $cursor: String) {
    metaobjects(first: 100, type: $type, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          handle
          type
          updatedAt
          fields {
            key
            value
            reference {
              ... on MediaImage {
                image {
                  url
                  altText
                }
              }
              ... on GenericFile {
                url
                mimeType
              }
              ... on Metaobject {
                id
                handle
              }
            }
          }
        }
      }
    }
  }
`;

// Fetch data from Shopify Storefront API
async function fetchShopifyData(query, variables = {}) {
  const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Check for GraphQL errors
  if (data.errors) {
    const errorMessages = data.errors.map(e => e.message).join('; ');
    throw new Error(`GraphQL errors: ${errorMessages}`);
  }

  return data;
}

// Fetch all articles with pagination
async function fetchAllArticles() {
  let allArticles = [];
  let hasNextPage = true;
  let cursor = null;

  console.log('Fetching blog articles...');
  
  while (hasNextPage) {
    const response = await fetchShopifyData(ARTICLES_QUERY, { cursor });
    const { edges, pageInfo } = response.data.articles;
    
    allArticles = allArticles.concat(edges.map(edge => edge.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    
    console.log(`Fetched ${allArticles.length} articles so far...`);
  }

  console.log(`Total articles fetched: ${allArticles.length}`);
  return allArticles;
}

// Fetch all pages with pagination
async function fetchAllPages() {
  let allPages = [];
  let hasNextPage = true;
  let cursor = null;

  console.log('Fetching CMS pages...');
  
  while (hasNextPage) {
    const response = await fetchShopifyData(PAGES_QUERY, { cursor });
    const { edges, pageInfo } = response.data.pages;
    
    allPages = allPages.concat(edges.map(edge => edge.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    
    console.log(`Fetched ${allPages.length} pages so far...`);
  }

  console.log(`Total pages fetched: ${allPages.length}`);
  return allPages;
}

// Fetch all metaobjects of a given type with pagination
async function fetchAllMetaobjects(type) {
  let allMetaobjects = [];
  let hasNextPage = true;
  let cursor = null;

  console.log(`Fetching metaobjects for type "${type}"...`);

  while (hasNextPage) {
    // small wait to give Shopify time to hydrate and to avoid rate limits between types
    await delay(500);

    const response = await fetchShopifyData(METAOBJECT_QUERY, { type, cursor });
    
    // Log full response for debugging if metaobjects is missing
    if (!response.data?.metaobjects) {
      console.error(`Response for type "${type}":`, JSON.stringify(response, null, 2));
      throw new Error(`Shopify response missing metaobjects for type ${type}. Response: ${JSON.stringify(response)}`);
    }

    const metaobjects = response.data.metaobjects;
    const { edges, pageInfo } = metaobjects;

    if (!edges || edges.length === 0) {
      console.log(`  No ${type} metaobjects in this batch`);
    } else {
      console.log(`  Found ${edges.length} ${type} metaobjects in this batch`);
    }

    allMetaobjects = allMetaobjects.concat(edges.map(edge => edge.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    console.log(`Fetched ${allMetaobjects.length} ${type} metaobjects so far...`);
  }

  console.log(`Total ${type} metaobjects fetched: ${allMetaobjects.length}`);
  return allMetaobjects;
}

// Clean HTML content for XML
function cleanContent(html) {
  if (!html) return '';
  
  // Remove HTML tags and decode entities
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Escape XML special characters
function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const METAOBJECT_FIELD_DEFAULTS = {
  title: ['title', 'name', 'heading'],
  description: ['description', 'summary', 'bio', 'body'],
  link: ['link', 'url', 'website', 'cta_url'],
  image: ['image', 'hero_image', 'poster', 'logo'],
};

const METAOBJECT_TYPE_HINTS = {
  exhibitor: {
    title: ['store_name'],
    description: ['store_description'],
    link: ['website', 'url', 'link'],
    image: ['store_logo_thumbnail', 'store_artwork_image_thumbnail'],
  },
  show: {
    title: ['title'],
    description: ['show_description'],
    link: ['url', 'link'],
    image: ['show_thumbnail', 'show_banner'],
  },
};

function buildFieldLookup(fields = []) {
  return fields.reduce((acc, field) => {
    acc[field.key] = field;
    return acc;
  }, {});
}

function getFieldValue(fieldLookup, keys = []) {
  for (const key of keys) {
    const field = fieldLookup[key];
    if (field) {
      // Return value even if empty string, but not if null/undefined
      const value = field.value;
      if (value !== null && value !== undefined) {
        return value;
      }
    }
  }
  return null;
}

function getImageUrlFromField(field) {
  if (!field?.reference) return null;
  const ref = field.reference;

  if (ref.image?.url) {
    return ref.image.url;
  }

  // GenericFile: check if it's an image by mimeType
  if (ref.url && ref.mimeType?.startsWith('image/')) {
    return ref.url;
  }

  return null;
}

function normalizeMetaobject(metaobject, type, { pathSegment } = {}) {
  const lookup = buildFieldLookup(metaobject.fields);
  const hints = METAOBJECT_TYPE_HINTS[type] || {};
  const defaultSegment = pathSegment || (type.endsWith('s') ? type : `${type}s`);

  const title =
    getFieldValue(lookup, hints.title || []) ||
    getFieldValue(lookup, METAOBJECT_FIELD_DEFAULTS.title) ||
    metaobject.handle;

  const description =
    getFieldValue(lookup, hints.description || []) ||
    getFieldValue(lookup, METAOBJECT_FIELD_DEFAULTS.description) ||
    metaobject.fields.map(field => field.value).join(' ');

  const link =
    getFieldValue(lookup, hints.link || []) ||
    getFieldValue(lookup, METAOBJECT_FIELD_DEFAULTS.link) ||
    `${SITE_URL}/${defaultSegment}/${metaobject.handle}`;

  const imageKeys = (hints.image || []).concat(METAOBJECT_FIELD_DEFAULTS.image);
  let imageUrl = null;
  for (const key of imageKeys) {
    if (lookup[key]) {
      imageUrl = getImageUrlFromField(lookup[key]);
      if (imageUrl) break;
    }
  }

  return {
    id: `${type}_${metaobject.handle}`,
    title,
    description,
    link,
    imageUrl,
    updatedAt: metaobject.updatedAt,
    type,
  };
}

// Generate XML feed for blog articles
function generateBlogXML(articles) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
  xml += '  <channel>\n';
  xml += `    <title>Latitudes Online Blog Feed</title>\n`;
  xml += `    <link>${SITE_URL}/blogs</link>\n`;
  xml += `    <description>Blog articles for Doofinder</description>\n\n`;

  articles.forEach(article => {
    const url = `${SITE_URL}/blogs/${article.blog.handle}/${article.handle}`;
    const description = cleanContent(article.excerpt || article.contentHtml);
    const imageUrl = article.image?.url || '';

    xml += '    <item>\n';
    xml += `      <g:id>blog_${article.handle}</g:id>\n`;
    xml += `      <title>${escapeXml(article.title)}</title>\n`;
    xml += `      <link>${escapeXml(url)}</link>\n`;
    xml += `      <description>${escapeXml(description)}</description>\n`;
    xml += `      <g:type>blog_article</g:type>\n`;
    
    if (imageUrl) {
      xml += `      <g:image_link>${escapeXml(imageUrl)}</g:image_link>\n`;
    }
    
    if (article.publishedAt) {
      xml += `      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>\n`;
    }
    
    if (article.author?.name) {
      xml += `      <author>${escapeXml(article.author.name)}</author>\n`;
    }
    
    if (article.tags && article.tags.length > 0) {
      article.tags.forEach(tag => {
        xml += `      <category>${escapeXml(tag)}</category>\n`;
      });
    }
    
    xml += '    </item>\n\n';
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  return xml;
}

// Generate XML feed for CMS pages
function generatePagesXML(pages) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
  xml += '  <channel>\n';
  xml += `    <title>Latitudes Online Pages Feed</title>\n`;
  xml += `    <link>${SITE_URL}/pages</link>\n`;
  xml += `    <description>CMS pages for Doofinder</description>\n\n`;

  pages.forEach(page => {
    const url = `${SITE_URL}/pages/${page.handle}`;
    const description = cleanContent(page.bodySummary || page.body);

    xml += '    <item>\n';
    xml += `      <g:id>page_${page.handle}</g:id>\n`;
    xml += `      <title>${escapeXml(page.title)}</title>\n`;
    xml += `      <link>${escapeXml(url)}</link>\n`;
    xml += `      <description>${escapeXml(description)}</description>\n`;
    xml += `      <g:type>cms_page</g:type>\n`;
    
    if (page.updatedAt) {
      xml += `      <pubDate>${new Date(page.updatedAt).toUTCString()}</pubDate>\n`;
    }
    
    xml += '    </item>\n\n';
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  return xml;
}

// Generate XML feed for metaobjects
function generateMetaobjectsXML(items, type, { label, pathSegment } = {}) {
  const labelText = label || type;
  const linkSegment = pathSegment || labelText.toLowerCase();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
  xml += '  <channel>\n';
  xml += `    <title>Latitudes Online ${labelText} Feed</title>\n`;
  xml += `    <link>${SITE_URL}/${linkSegment}</link>\n`;
  xml += `    <description>${labelText} metaobjects for Doofinder</description>\n\n`;

  items.forEach(item => {
    xml += '    <item>\n';
    xml += `      <g:id>${escapeXml(item.id)}</g:id>\n`;
    xml += `      <title>${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <description>${escapeXml(cleanContent(item.description))}</description>\n`;
    xml += `      <g:type>${type}</g:type>\n`;

    if (item.imageUrl) {
      xml += `      <g:image_link>${escapeXml(item.imageUrl)}</g:image_link>\n`;
    }

    if (item.updatedAt) {
      xml += `      <pubDate>${new Date(item.updatedAt).toUTCString()}</pubDate>\n`;
    }

    xml += '    </item>\n\n';
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  return xml;
}

// Main function
async function main() {
  try {
    console.log('Starting feed generation...\n');

    // Validate environment variables
    if (!SHOPIFY_STORE_DOMAIN || !STOREFRONT_ACCESS_TOKEN) {
      throw new Error('Missing required environment variables: SHOPIFY_STORE_DOMAIN and STOREFRONT_ACCESS_TOKEN');
    }

    // Fetch data
    const [articles, pages, exhibitorMetaobjects, showMetaobjects] = await Promise.all([
      fetchAllArticles(),
      fetchAllPages(),
      fetchAllMetaobjects('exhibitor'),
      fetchAllMetaobjects('shows'), 
    ]);

    console.log(`\nNormalizing metaobjects...`);
    console.log(`  Exhibitors: ${exhibitorMetaobjects.length} fetched`);
    console.log(`  Shows: ${showMetaobjects.length} fetched`);

    const exhibitors = exhibitorMetaobjects.map(metaobject =>
      normalizeMetaobject(metaobject, 'exhibitor', { pathSegment: 'pages/exhibitor' })
    );
    const shows = showMetaobjects.map(metaobject =>
      normalizeMetaobject(metaobject, 'show', { pathSegment: 'pages/shows' })
    );

    console.log(`  Exhibitors normalized: ${exhibitors.length}`);
    console.log(`  Shows normalized: ${shows.length}`);

    console.log(`\nGenerating XML feeds...`);
    
    // Generate blog XML
    const blogXml = generateBlogXML(articles);
    const blogOutputPath = 'doofinder-blogs-feed.xml';
    fs.writeFileSync(blogOutputPath, blogXml);
    
    // Generate pages XML
    const pagesXml = generatePagesXML(pages);
    const pagesOutputPath = 'doofinder-pages-feed.xml';
    fs.writeFileSync(pagesOutputPath, pagesXml);

    // Generate exhibitors XML
    const exhibitorsXml = generateMetaobjectsXML(exhibitors, 'exhibitor', {
      label: 'Exhibitors',
      pathSegment: 'pages/exhibitor',
    });
    const exhibitorsOutputPath = 'doofinder-exhibitors-feed.xml';
    fs.writeFileSync(exhibitorsOutputPath, exhibitorsXml);

    // Generate shows XML
    const showsXml = generateMetaobjectsXML(shows, 'show', {
      label: 'Shows',
      pathSegment: 'pages/shows',
    });
    const showsOutputPath = 'doofinder-shows-feed.xml';
    fs.writeFileSync(showsOutputPath, showsXml);

    console.log(`\n✅ Feeds generated successfully!`);
    console.log(`\n📝 Blog Feed:`);
    console.log(`   File: ${blogOutputPath}`);
    console.log(`   Items: ${articles.length} articles`);
    console.log(`   Size: ${(fs.statSync(blogOutputPath).size / 1024 / 1024).toFixed(2)} MB`);
    
    console.log(`\n📄 Pages Feed:`);
    console.log(`   File: ${pagesOutputPath}`);
    console.log(`   Items: ${pages.length} pages`);
    console.log(`   Size: ${(fs.statSync(pagesOutputPath).size / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n🎪 Exhibitors Feed:`);
    console.log(`   File: ${exhibitorsOutputPath}`);
    console.log(`   Items: ${exhibitors.length} exhibitors`);
    console.log(`   Size: ${(fs.statSync(exhibitorsOutputPath).size / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n🎭 Shows Feed:`);
    console.log(`   File: ${showsOutputPath}`);
    console.log(`   Items: ${shows.length} shows`);
    console.log(`   Size: ${(fs.statSync(showsOutputPath).size / 1024 / 1024).toFixed(2)} MB`);
    
    console.log(`\n📊 Total: ${articles.length + pages.length + exhibitors.length + shows.length} items`);

  } catch (error) {
    console.error('❌ Error generating feed:', error.message);
    process.exit(1);
  }
}

main();