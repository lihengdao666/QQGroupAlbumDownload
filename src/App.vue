<template>
  <div class="main">
    <el-steps simple :active="stepActive">
      <el-step title="输入群号" :icon="Edit" />
      <el-step title="选择相册" :icon="PictureRounded" />
      <el-step title="处理任务" :icon="Download" />
    </el-steps>
    <div v-if="stepActive == 0" class="content">
      <InputGroup
        v-model:qq-group-num="qqGroupNum"
        @getQQAlbumList="getQQAlbumList"
      />
    </div>
    <div
      v-if="stepActive == 1"
      style="
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        overflow: hidden;
      "
    >
      <SelectAlbum
        :qqAlbumList="qqAlbumList"
        :selectAlbumList="qqSelectAlbumList"
        @setSelectAlbumList="setSelectAlbumList"
        @back-page="backGroup"
        @startDownload="startDownload"
      ></SelectAlbum>
    </div>

    <div
      v-if="stepActive == 2"
      style="
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        overflow: hidden;
      "
    >
      <DownloadPage
        :qqAlbumList="qqSelectAlbumList"
        :qunId="qqGroupNum"
        @back-page="backSelectAlbum"
      >
      </DownloadPage>
    </div>
  </div>
</template>
<script lang="ts" setup>
import InputGroup from "@/components/InputGroup.vue";
import SelectAlbum from "@/components/SelectAlbum.vue";
import DownloadPage from "@/components/DownloadPage.vue";

import {
  Edit,
  Download,
  PictureRounded,
} from "@element-plus/icons-vue";
import { ref } from "vue";

interface Album {
  title: string;
  num: number;
}

const stepActive = ref(0);
const qqGroupNum = ref("");
const qqAlbumList = ref<Album[]>([]);
const qqSelectAlbumList = ref<Album[]>([]);
const getQQAlbumList = (list: Album[]) => {
  qqAlbumList.value = list;
  stepActive.value = 1;
  qqSelectAlbumList.value = [];
};
const setSelectAlbumList = (list: Album[]) => {
  qqSelectAlbumList.value = list;

};
const startDownload=()=>{
  stepActive.value = 2;
}
const backSelectAlbum = () => {
  stepActive.value = 1;
};
const backGroup = () => {
  stepActive.value = 0;
};
</script>

<style lang="scss">
.main {
  height: 100%;
  padding: 3% 5%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1 1 0;
  display: flex;
  justify-content: center;
  align-items: center;
}
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  height: 100vh;
}
body {
  margin: 0px;
}

nav {
  padding: 30px;

  a {
    font-weight: bold;
    color: #2c3e50;

    &.router-link-exact-active {
      color: #42b983;
    }
  }
}
</style>
