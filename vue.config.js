const { defineConfig } = require("@vue/cli-service");
const AutoImport = require("unplugin-auto-import/webpack").default;
const Components = require("unplugin-vue-components/webpack").default;
const { ElementPlusResolver } = require("unplugin-vue-components/resolvers");

module.exports = defineConfig({
  transpileDependencies: true,
  publicPath: "./",
  outputDir: "web",
  configureWebpack: {
    plugins: [
      AutoImport({
        resolvers: [ElementPlusResolver()],
        // 只导入使用的API，减少包大小
        imports: ['vue', 'vue-router']
      }),
      Components({
        resolvers: [ElementPlusResolver()]
      })
    ]
  },
  chainWebpack(config) {
    // 代码分割，按需加载
    config.optimization.splitChunks({
      chunks: 'all',
      cacheGroups: {
        vendor: {
          name: 'chunk-vendors',
          test: /[\\/]node_modules[\\/]/,
          priority: 10,
          chunks: 'initial'
        },
        elementplus: {
          name: 'chunk-element-plus',
          test: /[\\/]node_modules[\\/]element-plus[\\/]/,
          priority: 20,
          chunks: 'initial'
        },
        commons: {
          name: 'chunk-commons',
          minChunks: 3,
          priority: 5,
          reuseExistingChunk: true
        }
      }
    });
  }
});