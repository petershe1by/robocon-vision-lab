# 视觉物块实验室

ROBOCON 视觉方向免试题的浏览器配套环境。普通浏览器即可运行；相机、物块与标识图片均打包在网页中，无需相机、ROS或在线CDN。

在线使用：[视觉物块实验室](https://petershe1by.github.io/robocon-vision-lab/)。

对应的完整题面见[视觉方向免试题](docs/免试题.md)，包含基础、进阶两个难度和赛规物块参考图片。

## 同学如何使用

打开项目的 GitHub Pages 页面，或下载 `dist/index.html` 后双击离线打开。使用支持WebGL2的现代Chrome/Edge。

1. 选择主赛或四足方向，调整物块位置、旋转和相机视角。“复制物块”可生成同类多目标，最多12个物块。
2. “导出图像与内参 ZIP”下载一帧真实渲染图像和对应相机参数。
3. 自己的识别程序读取 `image.png`；PnP使用 `camera_info.json` 中的内参和真实尺寸。
4. 基础档可选择“点选四角”，按同一个面的左上、右上、右下、左下点选四个真实角点，再导出角点样本ZIP。
5. 主赛进阶可在页面记录背面颜色预测，再翻转同一物块，核对先前指定的相对面。
6. 勾选物块缓慢旋转，设置录制时长后点击“开始录制”（默认60秒，支持1–3600秒），或选择“持续录制 · 手动停止”，再点击“停止并导出”结束，获得WebM视频与内参，供连续识别或跟踪程序按帧处理。定时录制也允许提前手动停止。页面显示已录时间和已编码数据量，停止后打包下载；长视频会占用浏览器内存，建议分段录制并保持页面在前台。录制期间锁定水平视场角；视频不附逐帧真值，目标15 fps，实际帧率依赖浏览器与硬件。`camera_info.json`附带录制模式、请求时长（手动模式为null）和实际录制墙钟时长；视频时长请以解码时间戳为准。

网页提供图像与交互，不代替同学编写分类、自动角点或背面颜色预测程序。页面没有场地识别、导航或建塔任务。

### Python PnP示例

```sh
pip install numpy opencv-python
python examples/pnp_from_sample.py /path/to/vision_main_pnp_123.zip --headless

# 仓库已附一个实际从网页点选、导出的样本，可直接运行
python examples/pnp_from_sample.py samples/pnp_example.zip --headless

# 没有points.json时，在OpenCV窗口手动选四角；尺寸应与目标一致
python examples/pnp_from_sample.py /path/to/vision_main_sample_123.zip --edge-mm 200
```

## 目标

- 四足：200 mm立方体，食品、工具、仪器、药品四种标识，使用赛规图3原始标识贴图。
- 主赛：350 mm纯红方块、350 mm纯蓝方块、200 mm半红半蓝塔顶。
- 塔顶局部+Y面红、-Y面蓝，四个侧面均为上红下蓝。绕物块旋转后，颜色分布随刚体一起旋转。

## 文件与坐标约定

相机输出固定640×480；使用理想针孔模型，畸变参数为零。改变显示窗口大小不会改变图像内参，改变水平视场角会更新内参。

| 文件 | 用途 |
| --- | --- |
| `image.png` | 原始RGB渲染，不含界面选中框或手动点选标记 |
| `camera_info.json` | 内参、畸变参数、图像尺寸、时间与坐标定义 |
| `points.json` | 角点样本才包含：四组对应点、面边长和原点定义 |
| `ground_truth.json` | 勾选后另附：物块中心、各面坐标、投影角点，仅用于误差对照 |

几何和PnP单位为m；界面长度显示为mm。相机光学坐标X向右、Y向下、Z向前。编辑器的世界坐标Y向上。`T_object_to_camera_optical`为4×4行主序表示，乘以齐次列向量，将物块局部坐标变换到相机光学坐标。

`points.json`的原点是点击的方形面中心，不能直接当作立方体几何中心。手动选四角时，相机和物块应保持静止；页面在首次选点时冻结所导出的那一帧，并在场景变化时清空点选。

真值中的`projected_corners_px`为几何投影，不是遮挡裁剪后的检测框；`front_facing`只表示正面朝向相机，不保证未被其他物块遮挡。

## 能力范围

支持透视投影、纹理、多目标遮挡、光照调整和物块旋转。物块按旋转后最低顶点贴近桌面，没有刚体碰撞、重力动力学、真实镜头畸变或传感器噪声；随机进阶布局可能发生物块相交，用于局部遮挡练习，不是物理堆叠仿真。合成图像不能代替真实相机的最终验证。

浏览器源码中可访问模型真值，所以页面适合公开练习与样本生成。正式验收请另备未知摆放、留出图像或实拍测试，不依赖网页隐藏答案来防作弊。

## 开发与构建

```sh
npm ci
npm run build
python -m http.server 8000 --directory dist
```

构建结果为`dist/index.html`，全部脚本和贴图均内嵌。源代码在`src/app.js`，界面在`index.template.html`，规则标识在`assets/`。第三方许可证位于`dist/licenses/`，也内嵌在独立HTML文件中。

## GitHub Pages

在仓库 Settings → Pages 中将 Source 设为 **GitHub Actions**。推送到main后，`.github/workflows/pages.yml`将构建并部署dist目录。

原始标识来源见[素材来源](ASSET_SOURCES.md)。
